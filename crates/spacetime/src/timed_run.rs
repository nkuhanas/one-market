use crate::{access::admin, now_us, runtime, schema::*, timestamp};
use one_market_core::Result;
use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

fn deadline(origin_us: i64, duration_seconds: u64) -> Result<i64> {
    if !(1..=3_600).contains(&duration_seconds) {
        return Err("timed runs require 1..=3600 seconds".into());
    }
    origin_us
        .checked_add((duration_seconds as i64) * 1_000_000)
        .ok_or_else(|| "timed run deadline overflow".into())
}

pub(crate) fn clear(ctx: &ReducerContext) {
    // At most one row is inserted, but never reuse its scheduled ID: a queued
    // callback's cleanup must not delete a later run's replacement timer.
    for row in ctx.db.timed_run_stop().iter() {
        ctx.db
            .timed_run_stop()
            .scheduled_id()
            .delete(row.scheduled_id);
    }
}

#[reducer]
pub fn start_timed_run(
    ctx: &ReducerContext,
    profile: String,
    build_hash: String,
    duration_seconds: u64,
) -> Result<()> {
    admin(ctx)?;
    // Validate before attempting start; the reducer transaction also guarantees
    // a failed timer insertion cannot leave an unbounded running simulation.
    deadline(now_us(ctx), duration_seconds)?;
    crate::runtime::start_run(ctx, profile, build_hash, false)?;
    let r = runtime(ctx)?;
    let at = timestamp(deadline(
        r.origin.to_micros_since_unix_epoch(),
        duration_seconds,
    )?);
    ctx.db.timed_run_stop().insert(TimedRunStop {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(at),
        deadline: at,
        run_id: r.run_id,
        generation: r.generation,
    });
    Ok(())
}

/// A fresh evidence segment on the same paused world/cadence. This never
/// rehabilitates old failures or claims a mixed-age world as qualification.
#[reducer]
pub fn continue_timed_run(
    ctx: &ReducerContext,
    profile: String,
    build_hash: String,
    duration_seconds: u64,
) -> Result<()> {
    admin(ctx)?;
    deadline(now_us(ctx), duration_seconds)?;
    let mut r = runtime(ctx)?;
    if r.phase != "READY"
        || r.enabled
        || r.run_id == 0
        || ctx.db.tick_schedule().count() != 0
        || ctx.db.timed_run_stop().count() != 0
    {
        return Err("continuation requires a paused initialized run without schedules".into());
    }
    let mut previous = ctx
        .db
        .run_record()
        .run_id()
        .find(r.run_id)
        .ok_or("run missing")?;
    if previous.completed_at.is_none() {
        previous.status = "FAILED".into();
        if !previous.failure_reason.is_empty() {
            previous.failure_reason.push_str("; ");
        }
        previous
            .failure_reason
            .push_str("bounded continuation; previous segment closed");
        previous.completed_at = Some(ctx.timestamp);
        ctx.db.run_record().run_id().update(previous);
    }
    r.run_id = 0;
    r.next_slot = 0;
    ctx.db.runtime_config().id().update(r);
    // All validations, segment closure, start and timer insertion share one
    // reducer transaction. Any error leaves the previous paused world intact.
    start_timed_run(ctx, profile, build_hash, duration_seconds)
}

fn due(stop: &TimedRunStop, r: &RuntimeConfig, now: i64) -> bool {
    r.enabled
        && stop.run_id == r.run_id
        && stop.generation == r.generation
        && now >= stop.deadline.to_micros_since_unix_epoch()
}

pub(crate) fn stop_if_due(ctx: &ReducerContext, r: &RuntimeConfig) -> Result<bool> {
    if ctx
        .db
        .timed_run_stop()
        .iter()
        .next()
        .is_some_and(|stop| due(&stop, r, now_us(ctx)))
    {
        crate::runtime::pause(ctx, "timed run deadline reached")?;
        return Ok(true);
    }
    Ok(false)
}

#[reducer]
pub fn stop_timed_run(ctx: &ReducerContext, scheduled: TimedRunStop) -> Result<()> {
    if ctx.sender() != ctx.database_identity() {
        return Err("stop_timed_run is scheduler-only".into());
    }
    let r = runtime(ctx)?;
    // The scheduled row may already have been consumed by the runtime; use the
    // callback's immutable run/generation snapshot, never the current selection.
    if due(&scheduled, &r, now_us(ctx)) {
        crate::runtime::pause(ctx, "timed run deadline reached")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stop_deadline_is_bounded_checked_wall_time() {
        assert_eq!(deadline(1_000_000, 180).unwrap(), 181_000_000);
        assert_eq!(deadline(0, 3_600).unwrap(), 3_600_000_000);
        assert!(deadline(0, 0).is_err());
        assert!(deadline(0, 3_601).is_err());
        assert!(deadline(0, u64::MAX).is_err());
        assert!(deadline(i64::MAX, 1).is_err());
    }
}
