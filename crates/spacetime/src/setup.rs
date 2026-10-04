use crate::{access::admin, fresh_market, market, runtime, schema::*};
use one_market_core::{
    add, bucket, config::config, equity, extend_digest, policy::weights, Result,
};
use spacetimedb::{reducer, ReducerContext, Table};

#[reducer]
pub fn set_actor_population(ctx: &ReducerContext, population: u64, seed: u64) -> Result<()> {
    admin(ctx)?;
    let mut r = runtime(ctx)?;
    if r.phase != "EMPTY" || r.enabled {
        return Err("reset explicitly before changing population".into());
    }
    if population == 0 || population > config().population_max {
        return Err("population outside configured bounds".into());
    }
    r.target_population = population;
    r.initialized = 0;
    r.seed = seed;
    r.phase = "INITIALIZING".into();
    ctx.db.runtime_config().id().update(r);
    let mut m = market(ctx)?;
    m.phase = "INITIALIZING".into();
    ctx.db.market_state().id().update(m);
    Ok(())
}

#[reducer]
pub fn initialize_batch(ctx: &ReducerContext, count: u64) -> Result<()> {
    admin(ctx)?;
    let c = config();
    if count == 0 || count > c.setup_batch_max {
        return Err("invalid setup batch size".into());
    }
    let mut r = runtime(ctx)?;
    if r.phase == "READY" {
        return Ok(());
    }
    if r.phase != "INITIALIZING" {
        return Err("not initializing".into());
    }
    let end = add(r.initialized, count)?.min(r.target_population);
    for actor_id in add(r.initialized, 1)?..=end {
        let b = bucket(actor_id);
        let w = weights(r.seed, actor_id);
        let marked = equity(c.actor_cash_cents, c.actor_shares, c.initial_price_cents)?;
        let a = ActorState {
            actor_id,
            bucket: b,
            cash_cents: c.actor_cash_cents,
            shares: c.actor_shares,
            marked_equity_cents: marked,
            initial_endowment_value_cents: marked,
            life_peak_equity_cents: marked,
            cumulative_recapitalization_grants_cents: 0,
            momentum_weight: w.momentum,
            mean_reversion_weight: w.reversion,
            contrarian_weight: w.contrarian,
            news_weight: w.news,
            risk_tolerance_bps: w.risk,
            conviction_threshold_bps: w.conviction,
            last_step_tick: None.into(),
            status: ActorStatus::Active,
            cooldown_started_tick: None.into(),
            lifetime_pnl_cents: 0,
            wipeout_count: 0,
            filled_order_count: 0,
        };
        if actor_id <= c.sample_size {
            crate::lifecycle::sample(ctx, &a);
        }
        ctx.db.actor_state().insert(a);
        let mut manifest = ctx
            .db
            .bucket_manifest()
            .bucket()
            .find(b)
            .ok_or("manifest missing")?;
        manifest.actor_count = add(manifest.actor_count, 1)?;
        manifest.membership_digest = extend_digest(&manifest.membership_digest, actor_id);
        ctx.db.bucket_manifest().bucket().update(manifest);
    }
    let mut g = ctx
        .db
        .grant_accounting()
        .id()
        .find(0)
        .ok_or("accounting missing")?;
    let created = u128::from(end - r.initialized);
    g.actor_initial_cash_cents = g
        .actor_initial_cash_cents
        .checked_add(created * u128::from(c.actor_cash_cents))
        .ok_or("initial cash overflow")?;
    g.initial_share_supply = g
        .initial_share_supply
        .checked_add(created * u128::from(c.actor_shares))
        .ok_or("initial supply overflow")?;
    ctx.db.grant_accounting().id().update(g);
    r.initialized = end;
    if end == r.target_population {
        r.phase = "READY".into();
    }
    let mut m = market(ctx)?;
    m.actor_count = end;
    m.active_actor_count = end;
    m.phase = r.phase.clone();
    ctx.db.market_state().id().update(m);
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

#[reducer]
pub fn reset_market(ctx: &ReducerContext, confirmation: String) -> Result<()> {
    admin(ctx)?;
    if confirmation != "RESET WORLD" {
        return Err("explicit RESET WORLD confirmation required".into());
    }
    crate::timed_run::clear(ctx);
    let mut r = runtime(ctx)?;
    crate::runtime::fail_run(ctx, r.run_id, "world reset")?;
    r.enabled = false;
    r.generation = add(r.generation, 1)?;
    r.phase = "RESETTING".into();
    for s in ctx.db.tick_schedule().iter() {
        ctx.db.tick_schedule().scheduled_id().delete(s.scheduled_id);
    }
    ctx.db.runtime_config().id().update(r);
    let mut m = market(ctx)?;
    m.phase = "RESETTING".into();
    ctx.db.market_state().id().update(m);
    Ok(())
}

#[reducer]
pub fn reset_batch(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let mut r = runtime(ctx)?;
    if r.phase != "RESETTING" {
        return Err("not resetting".into());
    }
    let limit = config().setup_batch_max as usize;
    // Every call has a fixed per-table bound; no full-population reset transaction.
    macro_rules! prune {
        ($table:ident, $key:ident) => {{
            let rows: Vec<_> = ctx.db.$table().iter().take(limit).collect();
            for row in rows {
                ctx.db.$table().$key().delete(row.$key);
            }
            ctx.db.$table().count() == 0
        }};
    }
    let empty = prune!(actor_state, actor_id)
        & prune!(actor_recovery, actor_id)
        & prune!(human_trader, identity)
        & prune!(pending_human_order, identity)
        & prune!(human_order_receipt, key)
        & prune!(price_point, logical_tick)
        & prune!(public_activity, id)
        & prune!(news_event, id)
        & prune!(actor_sample, actor_id);
    // Retain the newest six detailed runs. Prune old receipts in bounded chunks.
    let retain_from = r
        .next_run_id
        .saturating_sub(config().detailed_run_retention - 1);
    let old_runs: Vec<_> = ctx
        .db
        .run_record()
        .iter()
        .filter(|run| run.run_id < retain_from)
        .collect();
    let mut evidence_done = true;
    for run in old_runs {
        let rows: Vec<_> = ctx
            .db
            .detailed_benchmark_receipts()
            .run_id()
            .filter(run.run_id)
            .take(limit)
            .collect();
        for row in rows {
            ctx.db.detailed_benchmark_receipts().key().delete(row.key);
        }
        if ctx
            .db
            .detailed_benchmark_receipts()
            .run_id()
            .filter(run.run_id)
            .next()
            .is_none()
        {
            ctx.db.run_record().run_id().delete(run.run_id);
            ctx.db.validated_run().run_id().delete(run.run_id);
            ctx.db.run_cadence().run_id().delete(run.run_id);
        } else {
            evidence_done = false;
        }
    }
    if empty && evidence_done {
        crate::timing::ensure(ctx);
        let mut cadence = ctx
            .db
            .cadence_state()
            .id()
            .find(0)
            .ok_or("cadence missing")?;
        cadence.requires_explicit_start = false;
        ctx.db.cadence_state().id().update(cadence);
        let connected = market(ctx)?.connected_identity_count;
        ctx.db
            .market_state()
            .id()
            .update(fresh_market(ctx.timestamp, connected));
        crate::revival::ensure(ctx, config().initial_price_cents);
        ctx.db
            .market_dynamics()
            .id()
            .update(crate::revival::fresh(config().initial_price_cents));
        for bucket in 0..20 {
            ctx.db
                .bucket_health()
                .bucket()
                .update(crate::revival::bucket_state(bucket));
        }
        r.phase = "EMPTY".into();
        r.target_population = 0;
        r.initialized = 0;
        r.run_id = 0;
        r.chaos_start = 0;
        r.chaos_end = 0;
        r.chaos_signal_bps = 0;
        r.imbalance_bps = 0;
        ctx.db.grant_accounting().id().update(GrantAccounting {
            id: 0,
            actor_initial_cash_cents: 0,
            human_entry_cash_cents: 0,
            recapitalization_cash_cents: 0,
            initial_share_supply: 0,
            human_entry_count: 0,
            recapitalization_count: 0,
        });
        for bucket in 0..20 {
            ctx.db.bucket_manifest().bucket().update(BucketManifest {
                bucket,
                actor_count: 0,
                membership_digest: vec![0; 32],
            });
        }
    }
    ctx.db.runtime_config().id().update(r);
    Ok(())
}
