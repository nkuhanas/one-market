use crate::{access::admin, schema::*, timing};
use one_market_core::{
    config::{config, workload_hash_at_cadence},
    evidence::{validate_at_cadence, Receipt},
    Result,
};
use spacetimedb::{reducer, ReducerContext, Table};

fn valid_hash(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

impl From<TickReceipt> for Receipt {
    fn from(r: TickReceipt) -> Self {
        Self {
            run_id: r.run_id,
            intended_slot: r.intended_slot,
            logical_tick: r.logical_tick,
            intended_at_us: r.intended_at.to_micros_since_unix_epoch(),
            invoked_at_us: r.invoked_at.to_micros_since_unix_epoch(),
            start_lateness_us: r.start_lateness_us,
            skipped_slots: r.skipped_slots,
            schedule_debt_us: r.schedule_debt_us,
            bucket: r.bucket,
            actor_steps: r.actor_steps,
            policy_evaluations: r.policy_evaluations,
            actor_rows_updated: r.actor_rows_updated,
            membership_digest: r.membership_digest,
            previous_steps_valid: r.previous_steps_valid,
            orders_submitted: r.orders_submitted,
            orders_filled: r.orders_filled,
            matched_share_volume: r.matched_share_volume,
        }
    }
}

/// Admin attests external load/health evidence; DB evidence is independently
/// revalidated here. No anonymous client can promote a live population to capacity.
#[reducer]
pub fn validate_run(
    ctx: &ReducerContext,
    run_id: u64,
    evidence_hash: String,
    load_valid: bool,
    connection_healthy: bool,
) -> Result<()> {
    admin(ctx)?;
    if !valid_hash(&evidence_hash) {
        return Err("evidence hash required".into());
    }
    let mut run = ctx
        .db
        .run_record()
        .run_id()
        .find(run_id)
        .ok_or("run missing")?;
    if !run.qualification || run.completed_at.is_none() {
        return Err("qualification run not complete".into());
    }
    let receipts: Vec<_> = ctx
        .db
        .detailed_benchmark_receipts()
        .run_id()
        .filter(run_id)
        .map(Receipt::from)
        .collect();
    let cadence = timing::for_run(ctx, run_id, &config())?;
    let validation = validate_at_cadence(
        &receipts,
        run_id,
        run.population,
        run.origin.to_micros_since_unix_epoch(),
        run.status == "FAILED",
        load_valid,
        connection_healthy,
        &cadence,
    );
    run.status = validation.status;
    run.failure_reason = validation.reasons.join("; ");
    if run.status == "PASSED" {
        let row = ValidatedRun {
            run_id,
            evidence_hash,
            measured_actor_updates: validation.measured_actor_updates,
            start_lateness_p99_us: validation.start_lateness_p99_us,
        };
        if ctx.db.validated_run().run_id().find(run_id).is_some() {
            ctx.db.validated_run().run_id().update(row);
        } else {
            ctx.db.validated_run().insert(row);
        }
    }
    ctx.db.run_record().run_id().update(run);
    Ok(())
}

#[reducer]
pub fn publish_benchmark_result(
    ctx: &ReducerContext,
    run_ids: Vec<u64>,
    environment: String,
    evidence_hash: String,
) -> Result<()> {
    admin(ctx)?;
    let c = config();
    if run_ids.len() != c.confirmation_runs as usize
        || !valid_hash(&evidence_hash)
        || (environment != "LOCAL" && environment != "MAINCLOUD")
    {
        return Err("invalid qualification publication".into());
    }
    let mut unique = run_ids.clone();
    unique.sort_unstable();
    unique.dedup();
    if unique.len() != run_ids.len() {
        return Err("three distinct fresh runs required".into());
    }
    let mut runs = vec![];
    let mut validations = vec![];
    for id in &run_ids {
        let run = ctx
            .db
            .run_record()
            .run_id()
            .find(*id)
            .ok_or("run evidence missing")?;
        if run.status != "PASSED" || !run.qualification {
            return Err("all runs must pass".into());
        }
        validations.push(
            ctx.db
                .validated_run()
                .run_id()
                .find(*id)
                .ok_or("load evidence missing")?,
        );
        runs.push(run);
    }
    let first = &runs[0];
    let cadence = timing::for_run(ctx, first.run_id, &c)?;
    if runs.iter().any(|r| {
        r.population != first.population
            || r.seed != first.seed
            || r.profile != first.profile
            || r.build_hash != first.build_hash
            || timing::for_run(ctx, r.run_id, &c).ok().as_ref() != Some(&cadence)
            || r.configuration_hash
                != workload_hash_at_cadence(r.population, r.seed, &r.profile, &cadence)
    }) {
        return Err("confirmation workload/build mismatch".into());
    }
    let result = ctx.db.benchmark_result().insert(BenchmarkResult {
        id: 0,
        status: "PASSED".into(),
        environment,
        workload_profile: first.profile.clone(),
        actor_count: first.population,
        tick_interval_us: cadence.tick_interval_us,
        bucket_count: c.buckets,
        warmup_seconds: c.warmup_seconds,
        measurement_seconds: c.measurement_seconds,
        repeat_count: c.confirmation_runs,
        subscriber_count: c.viewers,
        offered_human_orders_per_second: c.offered_orders_per_second,
        committed_actor_updates: validations
            .iter()
            .try_fold(0u64, |acc, v| acc.checked_add(v.measured_actor_updates))
            .ok_or("counter overflow")?,
        skipped_application_slots: 0,
        start_lateness_p99_us: validations
            .iter()
            .map(|v| v.start_lateness_p99_us)
            .max()
            .ok_or("no runs")?,
        configuration_hash: workload_hash_at_cadence(
            first.population,
            first.seed,
            &first.profile,
            &cadence,
        ),
        build_hash: first.build_hash.clone(),
        evidence_hash,
        run_ids,
        completed_at: Some(ctx.timestamp),
    });
    if result.id > c.result_retention {
        ctx.db
            .benchmark_result()
            .id()
            .delete(result.id - c.result_retention);
    }
    Ok(())
}
