//! Fault controls exist only in the separately compiled test module.
use crate::{access::admin, now_us, runtime, schema::*, timestamp};
use one_market_core::{add, Result};
use spacetimedb::{reducer, table, ReducerContext, ScheduleAt, Table};

#[table(accessor = test_fault)]
pub struct TestFault {
    #[primary_key]
    pub id: u8,
    pub fail_after_writes: bool,
}

#[reducer]
pub fn test_set_fault(ctx: &ReducerContext, fail_after_writes: bool) -> Result<()> {
    admin(ctx)?;
    let row = TestFault {
        id: 0,
        fail_after_writes,
    };
    if ctx.db.test_fault().id().find(0).is_some() {
        ctx.db.test_fault().id().update(row);
    } else {
        ctx.db.test_fault().insert(row);
    }
    Ok(())
}

/// Exercise complete production transactions/phases without wall-clock sleeps.
/// Only compiled into the disposable, separately hashed test-support module.
#[reducer]
pub fn test_step_many(ctx: &ReducerContext, count: u64) -> Result<()> {
    admin(ctx)?;
    if count > 600 || runtime(ctx)?.enabled {
        return Err("bounded paused-world stepping required".into());
    }
    for _ in 0..count {
        crate::runtime::benchmark_step(ctx)?;
    }
    Ok(())
}

#[reducer]
pub fn test_clear_revival_state(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    if runtime(ctx)?.enabled {
        return Err("pause before fixture setup".into());
    }
    ctx.db
        .market_dynamics()
        .id()
        .update(crate::revival::fresh(crate::market(ctx)?.price_cents));
    for bucket in 0..20 {
        ctx.db
            .bucket_health()
            .bucket()
            .update(crate::revival::bucket_state(bucket));
    }
    for record in ctx.db.actor_recovery().iter() {
        ctx.db.actor_recovery().actor_id().delete(record.actor_id);
    }
    Ok(())
}

#[reducer]
pub fn test_stale_configuration(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    if runtime(ctx)?.enabled {
        return Err("pause before fixture setup".into());
    }
    let mut market = crate::market(ctx)?;
    market.configuration_hash = "0".repeat(64);
    ctx.db.market_state().id().update(market);
    let mut run = ctx
        .db
        .run_record()
        .run_id()
        .find(runtime(ctx)?.run_id)
        .ok_or("run missing")?;
    run.configuration_hash = "1".repeat(64);
    ctx.db.run_record().run_id().update(run);
    Ok(())
}

pub fn check_fault(ctx: &ReducerContext) -> Result<()> {
    if ctx
        .db
        .test_fault()
        .id()
        .find(0)
        .is_some_and(|f| f.fail_after_writes)
    {
        return Err("injected failure after actor, reservation and receipt writes".into());
    }
    Ok(())
}

#[reducer]
pub fn test_delay_callback(ctx: &ReducerContext, delay_us: u64) -> Result<()> {
    admin(ctx)?;
    if delay_us > 1_000_000 {
        return Err("bounded test delay required".into());
    }
    let mut next = ctx.db.tick_schedule().iter().next().ok_or("no callback")?;
    next.scheduled_at = ScheduleAt::Time(timestamp(
        now_us(ctx)
            .checked_add(i64::try_from(delay_us).map_err(|_| "delay overflow")?)
            .ok_or("delay overflow")?,
    ));
    ctx.db.tick_schedule().scheduled_id().update(next);
    Ok(())
}

#[reducer]
pub fn test_stale_callback(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let r = runtime(ctx)?;
    ctx.db.tick_schedule().insert(TickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(timestamp(
            now_us(ctx).checked_add(1000).ok_or("delay overflow")?,
        )),
        generation: add(r.generation, 100)?,
        intended_slot: r.next_slot,
    });
    Ok(())
}

#[reducer]
pub fn test_corrupt_coverage(ctx: &ReducerContext, actor_id: u64) -> Result<()> {
    admin(ctx)?;
    let mut actor = ctx
        .db
        .actor_state()
        .actor_id()
        .find(actor_id)
        .ok_or("actor missing")?;
    actor.last_step_tick = Some(u64::MAX).into();
    ctx.db.actor_state().actor_id().update(actor);
    Ok(())
}

#[reducer]
pub fn test_actor_fixture(
    ctx: &ReducerContext,
    actor_id: u64,
    status: String,
    cash_cents: u64,
    shares: u64,
    cooldown_started_tick: Option<u64>,
) -> Result<()> {
    admin(ctx)?;
    if runtime(ctx)?.enabled {
        return Err("pause before fixture setup".into());
    }
    let status = match status.as_str() {
        "ACTIVE" => ActorStatus::Active,
        "EXITING" => ActorStatus::Exiting,
        "COOLDOWN" => ActorStatus::Cooldown,
        _ => return Err("invalid fixture state".into()),
    };
    let mut actor = ctx
        .db
        .actor_state()
        .actor_id()
        .find(actor_id)
        .ok_or("actor missing")?;
    let mut market = crate::market(ctx)?;
    if actor.status == ActorStatus::Active && status != ActorStatus::Active {
        market.active_actor_count = market
            .active_actor_count
            .checked_sub(1)
            .ok_or("active count underflow")?;
    }
    if actor.status != ActorStatus::Active && status == ActorStatus::Active {
        market.active_actor_count = add(market.active_actor_count, 1)?;
    }
    actor.status = status;
    actor.cash_cents = cash_cents;
    actor.shares = shares;
    actor.life_peak_equity_cents = one_market_core::equity(cash_cents, shares, market.price_cents)?;
    actor.cooldown_started_tick = cooldown_started_tick.into();
    actor.conviction_threshold_bps = u64::MAX;
    ctx.db.actor_state().actor_id().update(actor);
    ctx.db.market_state().id().update(market);
    Ok(())
}
