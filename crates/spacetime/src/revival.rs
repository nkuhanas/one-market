//! Economic revival never resets market price, inventory, or runtime evidence.
use crate::schema::*;
use one_market_core::{add, config::Config, equity, mix, Result};
use spacetimedb::{ReducerContext, Table};

pub fn fresh(price: u64) -> MarketDynamics {
    MarketDynamics {
        id: 0,
        reference_price_cents: price,
        sentiment_bps: 0,
        mode: "NORMAL".into(),
        floor_streak: 0,
        illiquid_streak: 0,
        healthy_streak: 0,
        distressed_buckets: 0,
        episode: 0,
        episode_started_tick: 0,
        next_recovery_tick: 0,
        revived_actors: 0,
        episode_grants_cents: 0,
        total_grants_cents: 0,
        constrained_grants: 0,
    }
}

pub fn bucket_state(bucket: u8) -> BucketHealth {
    BucketHealth {
        bucket,
        illiquid_epochs: 0,
        distressed: false,
    }
}

/// Called only for a new world or explicitly authorized workload adoption.
/// Existing state is never reinitialized on restart/repeated recovery.
pub fn ensure(ctx: &ReducerContext, price: u64) {
    if ctx.db.market_dynamics().id().find(0).is_none() {
        ctx.db.market_dynamics().insert(fresh(price));
    }
    for bucket in 0..20 {
        if ctx.db.bucket_health().bucket().find(bucket).is_none() {
            ctx.db.bucket_health().insert(bucket_state(bucket));
        }
    }
}

pub fn advance_reference(d: &mut MarketDynamics, seed: u64, tick: u64, c: &Config) -> Result<()> {
    if !tick.is_multiple_of(u64::from(c.buckets)) {
        return Ok(());
    }
    if c.sentiment_interval_ticks == 0
        || c.sentiment_smoothing_epochs == 0
        || c.reference_step_divisor == 0
        || c.sentiment_max_bps > 10_000
    {
        return Err("invalid sentiment configuration".into());
    }
    let target = (mix(seed ^ mix(tick / c.sentiment_interval_ticks) ^ 0x6d6f6f64)
        % (2 * c.sentiment_max_bps + 1)) as i64
        - c.sentiment_max_bps as i64;
    let difference = target - d.sentiment_bps;
    let step = difference / c.sentiment_smoothing_epochs as i64;
    d.sentiment_bps += if step == 0 { difference.signum() } else { step };
    let drift = d.sentiment_bps / c.reference_step_divisor as i64;
    let change = i128::from(d.reference_price_cents) * i128::from(drift) / 10_000;
    let change = if change == 0 {
        i128::from(drift.signum())
    } else {
        change
    };
    d.reference_price_cents = (i128::from(d.reference_price_cents) + change)
        .clamp(i128::from(c.min_price_cents), i128::from(c.max_price_cents))
        as u64;
    Ok(())
}

fn low_active(active: u64, population: u64, threshold: u64) -> bool {
    population > 0 && u128::from(active) * 10_000 <= u128::from(population) * u128::from(threshold)
}

#[allow(clippy::too_many_arguments)]
pub fn observe(
    d: &mut MarketDynamics,
    b: &mut BucketHealth,
    tick: u64,
    price: u64,
    volume: u64,
    active: u64,
    population: u64,
    bucket_active: u64,
    bucket_population: u64,
    c: &Config,
) -> Result<()> {
    if !c.revival_enabled {
        return Ok(());
    }
    let illiquid = volume == 0 && low_active(active, population, c.revival_low_active_bps);
    d.floor_streak = if price <= c.revival_floor_cents {
        add(d.floor_streak, 1)?
    } else {
        0
    };
    d.illiquid_streak = if illiquid {
        add(d.illiquid_streak, 1)?
    } else {
        0
    };
    b.illiquid_epochs =
        if volume == 0 && low_active(bucket_active, bucket_population, c.revival_low_active_bps) {
            add(b.illiquid_epochs, 1)?
        } else {
            0
        };
    let distressed = b.illiquid_epochs >= c.revival_distress_ticks.div_ceil(u64::from(c.buckets));
    if distressed != b.distressed {
        d.distressed_buckets = if distressed {
            add(d.distressed_buckets, 1)?
        } else {
            d.distressed_buckets
                .checked_sub(1)
                .ok_or("distressed bucket underflow")?
        };
        b.distressed = distressed;
    }
    let healthy = price > c.revival_floor_cents.saturating_mul(2)
        && volume > 0
        && population > 0
        && u128::from(active) * 10_000
            >= u128::from(population) * u128::from(c.revival_healthy_active_bps)
        && d.distressed_buckets == 0;
    d.healthy_streak = if healthy {
        add(d.healthy_streak, 1)?
    } else {
        0
    };
    let next_tick = add(tick, 1)?;
    if d.mode == "RECOVERY" {
        let elapsed = next_tick
            .checked_sub(d.episode_started_tick)
            .ok_or("recovery tick regression")?;
        let cohort_cycle = c
            .revival_cohort_epochs
            .checked_mul(u64::from(c.buckets))
            .ok_or("cohort cycle overflow")?;
        if elapsed >= c.revival_window_ticks
            || (elapsed >= cohort_cycle && d.healthy_streak >= c.revival_healthy_ticks)
        {
            d.mode = "BACKOFF".into();
            d.next_recovery_tick = add(next_tick, c.revival_backoff_ticks)?;
        }
    } else if next_tick >= d.next_recovery_tick {
        if d.floor_streak >= c.revival_distress_ticks
            || d.illiquid_streak >= c.revival_distress_ticks
            || d.distressed_buckets > 0
        {
            d.mode = "RECOVERY".into();
            d.episode = add(d.episode, 1)?;
            d.episode_started_tick = next_tick;
            d.episode_grants_cents = 0;
        } else {
            d.mode = if d.floor_streak > 0 || d.illiquid_streak > 0 {
                "DISTRESS"
            } else {
                "NORMAL"
            }
            .into();
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn try_revive(
    a: &mut ActorState,
    record: &mut ActorRecovery,
    d: &mut MarketDynamics,
    rank: usize,
    tick: u64,
    price: u64,
    population: u64,
    c: &Config,
) -> Result<Option<u64>> {
    if c.revival_cohort_epochs == 0 {
        return Err("invalid recovery cohort count".into());
    }
    if !c.revival_enabled
        || d.mode != "RECOVERY"
        || a.status != ActorStatus::Exiting
        || record.last_episode == d.episode
        || tick
            .checked_sub(record.exit_started_tick)
            .ok_or("exit timer regression")?
            < c.revival_exit_wait_ticks
        || rank as u64 % c.revival_cohort_epochs
            != (tick / u64::from(c.buckets)) % c.revival_cohort_epochs
    {
        return Ok(None);
    }
    let desired = c
        .bankroll_cents
        .saturating_sub(equity(a.cash_cents, a.shares, price)?);
    let world_endowment = u128::from(population) * u128::from(c.bankroll_cents);
    let episode_budget = world_endowment
        .checked_mul(u128::from(c.revival_episode_budget_bps))
        .ok_or("episode budget overflow")?
        / 10_000;
    let total_budget = world_endowment
        .checked_mul(u128::from(c.revival_total_budget_bps))
        .ok_or("total budget overflow")?
        / 10_000;
    let grant = u128::from(desired)
        .min(u128::from(
            c.revival_actor_cap_cents
                .saturating_sub(record.grants_cents),
        ))
        .min(episode_budget.saturating_sub(d.episode_grants_cents))
        .min(total_budget.saturating_sub(d.total_grants_cents)) as u64;
    if grant < desired {
        d.constrained_grants = add(d.constrained_grants, 1)?;
    }
    a.cash_cents = add(a.cash_cents, grant)?;
    a.cumulative_recapitalization_grants_cents =
        add(a.cumulative_recapitalization_grants_cents, grant)?;
    a.marked_equity_cents = equity(a.cash_cents, a.shares, price)?;
    a.life_peak_equity_cents = a.marked_equity_cents;
    a.status = ActorStatus::Active;
    a.cooldown_started_tick = None.into();
    record.last_episode = d.episode;
    record.grants_cents = add(record.grants_cents, grant)?;
    d.revived_actors = add(d.revived_actors, 1)?;
    d.episode_grants_cents = d
        .episode_grants_cents
        .checked_add(u128::from(grant))
        .ok_or("grant overflow")?;
    d.total_grants_cents = d
        .total_grants_cents
        .checked_add(u128::from(grant))
        .ok_or("grant overflow")?;
    Ok(Some(grant))
}

#[cfg(test)]
mod tests {
    use super::*;
    use one_market_core::config::config;

    #[test]
    fn distress_uses_completed_ticks_and_isolated_bucket_health() {
        let c = config();
        let mut d = fresh(10_000);
        let mut health: Vec<_> = (0..20).map(bucket_state).collect();
        // Ninety-five percent of the world is active, but bucket 0 has no buyers.
        for tick in 0..581 {
            let bucket = (tick % 20) as usize;
            observe(
                &mut d,
                &mut health[bucket],
                tick,
                10_000,
                u64::from(bucket != 0),
                190,
                200,
                if bucket == 0 { 0 } else { 10 },
                10,
                &c,
            )
            .unwrap();
            if tick < 580 {
                assert_ne!(d.mode, "RECOVERY");
            }
        }
        assert_eq!(d.mode, "RECOVERY");
        assert_eq!(d.distressed_buckets, 1);
        assert_eq!(d.episode_started_tick, 581);
        assert_eq!(d.floor_streak, 0);
        assert_eq!(d.illiquid_streak, 0);
        let before = d.clone();
        // Wall-clock pause/restart performs no observe call and cannot advance timers.
        assert_eq!(before, d);
        for tick in 581..1781 {
            observe(
                &mut d,
                &mut health[(tick % 20) as usize],
                tick,
                1,
                0,
                0,
                200,
                0,
                10,
                &c,
            )
            .unwrap();
        }
        assert_eq!(d.mode, "BACKOFF");
        assert_eq!(d.next_recovery_tick, 2981);
        for tick in 1781..2980 {
            observe(
                &mut d,
                &mut health[(tick % 20) as usize],
                tick,
                1,
                0,
                0,
                200,
                0,
                10,
                &c,
            )
            .unwrap();
            assert_eq!(d.episode, 1);
        }
        observe(&mut d, &mut health[0], 2980, 1, 0, 0, 200, 0, 10, &c).unwrap();
        assert_eq!(d.episode, 2);
    }

    #[test]
    fn shared_reference_is_seeded_persistent_bounded_and_not_traded_price() {
        let c = config();
        let mut a = fresh(10_000);
        let mut b = a.clone();
        for tick in 0..4000 {
            advance_reference(&mut a, 42, tick, &c).unwrap();
            advance_reference(&mut b, 42, tick, &c).unwrap();
            assert_eq!(a, b);
            assert!(a.sentiment_bps.unsigned_abs() <= c.sentiment_max_bps);
            assert!((c.min_price_cents..=c.max_price_cents).contains(&a.reference_price_cents));
        }
        assert_ne!(a.reference_price_cents, c.initial_price_cents);
        assert_eq!(a.episode, 0);
    }

    #[test]
    fn healthy_flat_trading_gets_no_recovery_and_one_floor_trade_does_not_trigger() {
        let c = config();
        let mut d = fresh(10_000);
        let mut health: Vec<_> = (0..20).map(bucket_state).collect();
        for tick in 0..2400 {
            let price = if tick == 0 { 1 } else { 10_000 };
            observe(
                &mut d,
                &mut health[(tick % 20) as usize],
                tick,
                price,
                10,
                200,
                200,
                10,
                10,
                &c,
            )
            .unwrap();
        }
        assert_eq!(d.mode, "NORMAL");
        assert_eq!(d.episode, 0);
        assert_eq!(d.total_grants_cents, 0);
    }
}
