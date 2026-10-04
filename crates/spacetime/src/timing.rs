use crate::{access::admin, market, runtime, schema::*};
use one_market_core::{
    add,
    config::{config, configuration_hash, Cadence, Config},
    Result,
};
use spacetimedb::{reducer, ReducerContext, Table};

pub fn ensure(ctx: &ReducerContext) {
    if ctx.db.cadence_state().id().find(0).is_none() {
        let c = config();
        let cadence = if ctx.db.runtime_config().id().find(0).is_some() {
            c.cadence("20hz").expect("legacy profile retained")
        } else {
            c.default_cadence()
        };
        ctx.db.cadence_state().insert(CadenceState {
            id: 0,
            profile: cadence.id,
            tick_interval_us: cadence.tick_interval_us,
            bucket_count: c.buckets,
            requires_explicit_start: false,
        });
    }
}

pub fn selected(ctx: &ReducerContext, c: &Config) -> Result<Cadence> {
    let Some(row) = ctx.db.cadence_state().id().find(0) else {
        // Existing modules have always used this profile, regardless of a future
        // compiled default. Publication must not silently alter their cadence.
        return c.cadence("20hz");
    };
    let cadence = c.cadence(&row.profile)?;
    if row.tick_interval_us != cadence.tick_interval_us || row.bucket_count != c.buckets {
        return Err("persisted cadence differs from compiled profile".into());
    }
    Ok(cadence)
}

pub fn for_run(ctx: &ReducerContext, run_id: u64, c: &Config) -> Result<Cadence> {
    let Some(row) = ctx.db.run_cadence().run_id().find(run_id) else {
        return c.cadence("20hz"); // legacy evidence only, never infer current selection
    };
    let cadence = c.cadence(&row.profile)?;
    if cadence.tick_interval_us != row.tick_interval_us || row.bucket_count != c.buckets {
        return Err("run cadence differs from compiled profile".into());
    }
    Ok(cadence)
}

#[reducer]
pub fn set_cadence_profile(ctx: &ReducerContext, profile: String) -> Result<()> {
    admin(ctx)?;
    let c = config();
    let cadence = c.cadence(&profile)?;
    let mut r = runtime(ctx)?;
    if r.enabled || ctx.db.tick_schedule().count() != 0 {
        return Err("pause simulation before selecting a cadence".into());
    }
    if r.phase != "EMPTY" && r.phase != "READY" {
        return Err("cadence selection requires an empty or ready world".into());
    }
    if market(ctx)?.configuration_hash != configuration_hash() {
        return Err("explicitly adopt the changed workload before selecting cadence".into());
    }
    ensure(ctx);
    if selected(ctx, &c)? == cadence {
        return Ok(());
    }
    let requires_explicit_start = r.run_id != 0
        || market(ctx)?.logical_tick != 0
        || ctx
            .db
            .cadence_state()
            .id()
            .find(0)
            .is_some_and(|s| s.requires_explicit_start);
    if let Some(mut run) = ctx.db.run_record().run_id().find(r.run_id) {
        if run.completed_at.is_none() {
            run.status = "FAILED".into();
            if !run.failure_reason.is_empty() {
                run.failure_reason.push_str("; ");
            }
            run.failure_reason.push_str(&format!(
                "cadence changed to {}; segment closed",
                cadence.id
            ));
            run.completed_at = Some(ctx.timestamp);
            ctx.db.run_record().run_id().update(run);
        }
    }
    r.run_id = 0;
    r.next_slot = 0;
    r.generation = add(r.generation, 1)?;
    ctx.db.runtime_config().id().update(r);
    ctx.db.cadence_state().id().update(CadenceState {
        id: 0,
        profile: cadence.id,
        tick_interval_us: cadence.tick_interval_us,
        bucket_count: c.buckets,
        requires_explicit_start,
    });
    Ok(())
}

/// Explicit bounded evidence maintenance, independent of destructive world reset.
/// Archive before calling; active/current run evidence cannot be pruned.
#[reducer]
pub fn prune_run_evidence(ctx: &ReducerContext, run_id: u64, confirmation: String) -> Result<()> {
    admin(ctx)?;
    if confirmation != format!("PRUNE RUN {run_id}") || run_id == runtime(ctx)?.run_id {
        return Err("explicit confirmation and a non-current run required".into());
    }
    let run = ctx
        .db
        .run_record()
        .run_id()
        .find(run_id)
        .ok_or("run missing")?;
    if run.completed_at.is_none() {
        return Err("only completed evidence segments may be pruned".into());
    }
    let rows: Vec<_> = ctx
        .db
        .detailed_benchmark_receipts()
        .run_id()
        .filter(run_id)
        .take(config().setup_batch_max as usize)
        .collect();
    for row in rows {
        ctx.db.detailed_benchmark_receipts().key().delete(row.key);
    }
    if ctx
        .db
        .detailed_benchmark_receipts()
        .run_id()
        .filter(run_id)
        .next()
        .is_none()
    {
        ctx.db.validated_run().run_id().delete(run_id);
        ctx.db.run_cadence().run_id().delete(run_id);
        ctx.db.run_record().run_id().delete(run_id);
    }
    Ok(())
}
