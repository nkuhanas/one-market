use crate::{access::admin, market, now_us, runtime, schema::*, timestamp, timing};
use one_market_core::{add, config::config, Result};
use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

fn deadline(start: i64, seconds: u64) -> Result<i64> {
    let micros = seconds
        .checked_mul(1_000_000)
        .and_then(|n| i64::try_from(n).ok())
        .filter(|n| *n > 0)
        .ok_or("invalid CHAOS duration")?;
    start
        .checked_add(micros)
        .ok_or("CHAOS deadline overflow".into())
}

pub(crate) fn cancel_timers(ctx: &ReducerContext) {
    for row in ctx.db.chaos_expiry().iter() {
        ctx.db
            .chaos_expiry()
            .scheduled_id()
            .delete(row.scheduled_id);
    }
}

pub(crate) fn shock(ctx: &ReducerContext, r: &mut RuntimeConfig, tick: u64) -> Result<()> {
    let c = config();
    let cadence = timing::selected(ctx, &c)?;
    let at = timestamp(deadline(now_us(ctx), c.chaos_duration_seconds)?);
    r.chaos_start = tick;
    // Compatibility/presentation estimate only. The wall clock is authoritative.
    r.chaos_end = add(tick, cadence.ticks_for_seconds(c.chaos_duration_seconds)?)?;
    r.chaos_signal_bps = -i64::try_from(
        u128::from(c.chaos_severity_bps) * u128::from(c.chaos_confidence_bps) / 10_000,
    )
    .map_err(|_| "news overflow")?;
    let id = r.next_news_id;
    r.next_news_id = add(id, 1)?;
    ctx.db.news_event().insert(NewsEvent {
        id,
        headline: "ONE Industries admits its lunar revenue division does not actually exist."
            .into(),
        direction: -1,
        severity_bps: c.chaos_severity_bps,
        confidence_bps: c.chaos_confidence_bps,
        start_tick: tick,
        end_tick: r.chaos_end,
    });
    if id > c.news_retention {
        ctx.db.news_event().id().delete(id - c.news_retention);
    }
    cancel_timers(ctx);
    ctx.db.chaos_expiry().insert(ChaosExpiry {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(at),
        news_id: id,
        started_at: ctx.timestamp,
        deadline: at,
    });
    Ok(())
}

fn finish(ctx: &ReducerContext, r: &mut RuntimeConfig, m: &mut MarketState) {
    let was_active = m.chaos_active || ctx.db.chaos_expiry().count() != 0;
    cancel_timers(ctx);
    // Empty, nonzero interval prevents automatic benchmark shock reactivation.
    let ended = m.logical_tick.max(1);
    r.chaos_start = ended;
    r.chaos_end = ended;
    r.chaos_signal_bps = 0;
    m.chaos_active = false;
    if was_active {
        if let Some(mut event) = ctx
            .db
            .news_event()
            .id()
            .find(r.next_news_id.saturating_sub(1))
        {
            event.end_tick = m.logical_tick;
            ctx.db.news_event().id().update(event);
        }
    }
}

/// Called before policy evaluation and public activation as a delayed-callback
/// safety net. Pauses and cadence changes never extend a persisted deadline.
pub(crate) fn refresh(ctx: &ReducerContext, r: &mut RuntimeConfig, m: &mut MarketState) {
    if let Some(expiry) = ctx.db.chaos_expiry().iter().next() {
        if now_us(ctx) >= expiry.deadline.to_micros_since_unix_epoch() {
            finish(ctx, r, m);
        } else {
            m.chaos_active = expiry.news_id == r.next_news_id.saturating_sub(1);
        }
    } else {
        // Publication does not rewrite legacy shocks. An explicit owner clear
        // ends them; every shock triggered by this build has a wall-clock timer.
        m.chaos_active = m.logical_tick >= r.chaos_start && m.logical_tick < r.chaos_end;
    }
}

fn is_due(current: &ChaosExpiry, callback: &ChaosExpiry, news_id: u64, now: i64) -> bool {
    current.scheduled_id == callback.scheduled_id
        && current.news_id == callback.news_id
        && current.news_id == news_id
        && current.deadline == callback.deadline
        && now >= current.deadline.to_micros_since_unix_epoch()
}

#[reducer]
pub fn expire_chaos(ctx: &ReducerContext, scheduled: ChaosExpiry) -> Result<()> {
    if ctx.sender() != ctx.database_identity() {
        return Err("expire_chaos is scheduler-only".into());
    }
    let mut r = runtime(ctx)?;
    let Some(current) = ctx.db.chaos_expiry().iter().next() else {
        return Ok(());
    };
    if is_due(
        &current,
        &scheduled,
        r.next_news_id.saturating_sub(1),
        now_us(ctx),
    ) {
        let mut m = market(ctx)?;
        finish(ctx, &mut r, &mut m);
        ctx.db.runtime_config().id().update(r);
        ctx.db.market_state().id().update(m);
    }
    Ok(())
}

#[reducer]
pub fn trigger_chaos(ctx: &ReducerContext) -> Result<()> {
    let mut r = runtime(ctx)?;
    if r.phase != "READY" {
        return Err("world is not ready".into());
    }
    let mut m = market(ctx)?;
    refresh(ctx, &mut r, &mut m);
    if m.chaos_active {
        return Ok(());
    }
    crate::runtime::fail_run(ctx, r.run_id, "manual shock changed workload")?;
    shock(ctx, &mut r, m.logical_tick)?;
    m.chaos_active = true;
    ctx.db.market_state().id().update(m);
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

/// Owner-only shock reset; no actor/account/tick/simulation-schedule mutation.
#[reducer]
pub fn clear_chaos(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let mut r = runtime(ctx)?;
    if r.phase != "READY" {
        return Err("world is not ready".into());
    }
    let mut m = market(ctx)?;
    if m.chaos_active {
        crate::runtime::fail_run(ctx, r.run_id, "manual shock reset changed workload")?;
    }
    finish(ctx, &mut r, &mut m);
    ctx.db.runtime_config().id().update(r);
    ctx.db.market_state().id().update(m);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minute_is_wall_clock_and_checked_at_every_cadence() {
        let c = config();
        assert_eq!(c.chaos_duration_seconds, 60);
        for cadence in &c.cadence_profiles {
            assert_eq!(deadline(123, c.chaos_duration_seconds).unwrap(), 60_000_123);
            assert_eq!(
                cadence.ticks_for_seconds(60).unwrap() * cadence.tick_interval_us,
                60_000_000
            );
        }
        assert!(deadline(i64::MAX, 60).is_err());
        assert!(deadline(0, u64::MAX).is_err());
        assert!(deadline(0, 0).is_err());
    }

    #[test]
    fn expiry_rejects_early_or_superseded_callbacks() {
        let current = ChaosExpiry {
            scheduled_id: 7,
            scheduled_at: ScheduleAt::Time(timestamp(60_000_000)),
            news_id: 3,
            started_at: timestamp(0),
            deadline: timestamp(60_000_000),
        };
        assert!(!is_due(&current, &current, 3, 59_999_999));
        assert!(is_due(&current, &current, 3, 60_000_000));
        assert!(!is_due(&current, &current, 4, 60_000_000));
        let mut stale = current.clone();
        stale.scheduled_id = 6;
        assert!(!is_due(&current, &stale, 3, 60_000_000));
        stale = current.clone();
        stale.news_id = 2;
        assert!(!is_due(&current, &stale, 3, 60_000_000));
    }
}
