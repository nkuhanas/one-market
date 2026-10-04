use crate::schema::*;
use one_market_core::{add, config::Config, equity, policy, Result};
use spacetimedb::{ReducerContext, Table};

pub fn sample(ctx: &ReducerContext, a: &ActorState) {
    let row = ActorSample {
        actor_id: a.actor_id,
        status: a.status.as_str().into(),
        marked_equity_cents: a.marked_equity_cents,
        lifetime_pnl_cents: a.lifetime_pnl_cents,
        wipeout_count: a.wipeout_count,
        last_step_tick: a.last_step_tick.get(),
    };
    if ctx.db.actor_sample().actor_id().find(a.actor_id).is_some() {
        ctx.db.actor_sample().actor_id().update(row);
    } else {
        ctx.db.actor_sample().insert(row);
    }
}

/// Returns (grant, transition); no database actor writes until final settlement.
pub fn prepare(
    a: &mut ActorState,
    price: u64,
    tick: u64,
    c: &Config,
) -> Result<(u64, Option<&'static str>)> {
    a.marked_equity_cents = equity(a.cash_cents, a.shares, price)?;
    a.life_peak_equity_cents = a.life_peak_equity_cents.max(a.marked_equity_cents);
    if a.status == ActorStatus::Active
        && u128::from(a.marked_equity_cents) * 10_000
            <= u128::from(a.life_peak_equity_cents) * u128::from(c.drawdown_bps)
    {
        a.status = ActorStatus::Exiting;
        a.wipeout_count = add(a.wipeout_count, 1)?;
        if a.shares == 0 {
            a.status = ActorStatus::Cooldown;
            a.cooldown_started_tick = Some(tick).into();
        }
        return Ok((0, Some("WIPED — DRAWDOWN LIMIT")));
    }
    if a.status == ActorStatus::Exiting && a.shares == 0 {
        a.status = ActorStatus::Cooldown;
        a.cooldown_started_tick = Some(tick).into();
        return Ok((0, Some("COOLDOWN")));
    }
    if a.status == ActorStatus::Cooldown
        && tick
            .checked_sub(
                a.cooldown_started_tick
                    .get()
                    .ok_or("missing cooldown start")?,
            )
            .ok_or("cooldown tick regression")?
            >= c.cooldown_ticks
    {
        let grant = c.bankroll_cents.saturating_sub(a.cash_cents);
        a.cash_cents = add(a.cash_cents, grant)?;
        a.cumulative_recapitalization_grants_cents =
            add(a.cumulative_recapitalization_grants_cents, grant)?;
        a.marked_equity_cents = equity(a.cash_cents, a.shares, price)?;
        a.life_peak_equity_cents = a.marked_equity_cents;
        a.status = ActorStatus::Active;
        a.cooldown_started_tick = None.into();
        return Ok((grant, Some("RECAPITALIZED")));
    }
    Ok((0, None))
}

pub fn finish(a: &mut ActorState, tick: u64, price: u64) -> Result<()> {
    if a.status == ActorStatus::Exiting && a.shares == 0 {
        a.status = ActorStatus::Cooldown;
        a.cooldown_started_tick = Some(tick).into();
    }
    a.marked_equity_cents = equity(a.cash_cents, a.shares, price)?;
    a.life_peak_equity_cents = a.life_peak_equity_cents.max(a.marked_equity_cents);
    a.lifetime_pnl_cents = policy::pnl(
        a.marked_equity_cents,
        a.initial_endowment_value_cents,
        a.cumulative_recapitalization_grants_cents,
    )?;
    a.last_step_tick = Some(tick).into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use one_market_core::{
        auction::{clear, Order},
        config::config,
    };

    fn actor() -> ActorState {
        ActorState {
            actor_id: 1,
            bucket: 0,
            cash_cents: 100,
            shares: 10,
            marked_equity_cents: 200,
            initial_endowment_value_cents: 200,
            life_peak_equity_cents: 1000,
            cumulative_recapitalization_grants_cents: 0,
            momentum_weight: 0,
            mean_reversion_weight: 0,
            contrarian_weight: 0,
            news_weight: 0,
            risk_tolerance_bps: 1000,
            conviction_threshold_bps: 100,
            last_step_tick: None.into(),
            status: ActorStatus::Active,
            cooldown_started_tick: None.into(),
            lifetime_pnl_cents: 0,
            wipeout_count: 0,
            filled_order_count: 0,
        }
    }

    #[test]
    fn private_actor_encoding_is_fixed_width_and_lossless() {
        use spacetimedb::sats::bsatn;
        let mut encoded_length = None;
        for status in [
            ActorStatus::Active,
            ActorStatus::Exiting,
            ActorStatus::Cooldown,
        ] {
            for last in [None, Some(0), Some(20), Some(u64::MAX)] {
                for cooldown in [None, Some(0), Some(20), Some(u64::MAX)] {
                    let mut a = actor();
                    a.status = status;
                    a.last_step_tick = last.into();
                    a.cooldown_started_tick = cooldown.into();
                    let bytes = bsatn::to_vec(&a).unwrap();
                    assert_eq!(*encoded_length.get_or_insert(bytes.len()), bytes.len());
                    let decoded: ActorState = bsatn::from_slice(&bytes).unwrap();
                    assert_eq!(decoded.status, status);
                    assert_eq!(decoded.last_step_tick.get(), last);
                    assert_eq!(decoded.cooldown_started_tick.get(), cooldown);
                    assert_eq!(decoded.cash_cents, a.cash_cents);
                    assert_eq!(decoded.shares, a.shares);
                    assert_eq!(decoded.momentum_weight, a.momentum_weight);
                    assert_eq!(decoded.lifetime_pnl_cents, a.lifetime_pnl_cents);
                }
            }
        }
        assert_eq!(ActorStatus::Active.as_str(), "ACTIVE");
        assert_eq!(ActorStatus::Exiting.as_str(), "EXITING");
        assert_eq!(ActorStatus::Cooldown.as_str(), "COOLDOWN");
    }

    #[test]
    fn drawdown_exits_require_buyers_then_cooldown_and_grant() {
        let c = config();
        let mut a = actor();
        assert_eq!(
            prepare(&mut a, 10, 0, &c).unwrap(),
            (0, Some("WIPED — DRAWDOWN LIMIT"))
        );
        assert_eq!(a.status, ActorStatus::Exiting);
        let (_, quantity, limit) = policy::liquidation(a.shares, 10, &c).unwrap().unwrap();
        let sell = Order {
            key: 1,
            buy: false,
            quantity,
            limit,
        };
        let frozen = clear(std::slice::from_ref(&sell), 10, 1).unwrap();
        assert_eq!((frozen.price, frozen.volume), (10, 0));
        finish(&mut a, 0, frozen.price).unwrap();
        assert_eq!(a.status, ActorStatus::Exiting);
        assert_eq!(a.last_step_tick.get(), Some(0));
        let buy = Order {
            key: 2,
            buy: true,
            quantity: 4,
            limit: 10,
        };
        let partial = clear(&[sell.clone(), buy], 10, 1).unwrap();
        (a.cash_cents, a.shares) = policy::settle(
            a.cash_cents,
            a.shares,
            false,
            partial.fills[0],
            partial.price,
        )
        .unwrap();
        finish(&mut a, 20, partial.price).unwrap();
        assert_eq!(a.shares, 6);
        assert_eq!(a.status, ActorStatus::Exiting);
        (a.cash_cents, a.shares) = policy::settle(a.cash_cents, a.shares, false, 6, 10).unwrap();
        finish(&mut a, 40, 10).unwrap();
        assert_eq!(a.status, ActorStatus::Cooldown);
        assert_eq!(a.cooldown_started_tick.get(), Some(40));
        assert_eq!(prepare(&mut a, 10, 59, &c).unwrap(), (0, None));
        finish(&mut a, 59, 10).unwrap();
        assert_eq!(a.last_step_tick.get(), Some(59));
        let cash_before = a.cash_cents;
        let (grant, event) = prepare(&mut a, 10, 60, &c).unwrap();
        assert_eq!(grant, c.bankroll_cents - cash_before);
        assert_eq!(event, Some("RECAPITALIZED"));
        assert_eq!(a.shares, 0);
        assert_eq!(a.wipeout_count, 1);
        assert_eq!(a.status, ActorStatus::Active);
        finish(&mut a, 60, 10).unwrap();
        assert_eq!(a.lifetime_pnl_cents, cash_before as i64 - 200);
        assert_eq!(a.life_peak_equity_cents, c.bankroll_cents);
    }

    #[test]
    fn no_shares_exit_and_zero_grant_are_well_defined() {
        let c = config();
        let mut a = actor();
        a.shares = 0;
        prepare(&mut a, 10, 0, &c).unwrap();
        assert_eq!(a.status, ActorStatus::Cooldown);
        a.cash_cents = c.bankroll_cents + 1;
        assert_eq!(
            prepare(&mut a, 10, 20, &c).unwrap(),
            (0, Some("RECAPITALIZED"))
        );
        assert_eq!(a.cash_cents, c.bankroll_cents + 1);
        assert_eq!(a.cumulative_recapitalization_grants_cents, 0);
    }
}
