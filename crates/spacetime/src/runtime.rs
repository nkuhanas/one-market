use crate::{access::admin, lifecycle, market, now_us, runtime, schema::*, timestamp};
use one_market_core::{
    add,
    auction::{self, Order},
    config::{config, configuration_hash, workload_hash},
    equity, extend_digest, mix,
    policy::{self, Signals, Weights},
    schedule, Result,
};
use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

pub fn fail_run(ctx: &ReducerContext, id: u64, reason: &str) -> Result<()> {
    if let Some(mut run) = ctx.db.run_record().run_id().find(id) {
        // Completed evidence is immutable across the next world's reset.
        if run.completed_at.is_none() && run.status != "FAILED" {
            run.status = "FAILED".into();
            run.failure_reason = reason.into();
            ctx.db.run_record().run_id().update(run);
        }
    }
    Ok(())
}

fn enqueue(ctx: &ReducerContext, r: &RuntimeConfig) -> Result<()> {
    ctx.db.tick_schedule().insert(TickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(timestamp(schedule::deadline(
            r.origin.to_micros_since_unix_epoch(),
            r.next_slot,
        )?)),
        generation: r.generation,
        intended_slot: r.next_slot,
    });
    Ok(())
}

#[reducer]
pub fn start_run(
    ctx: &ReducerContext,
    profile: String,
    build_hash: String,
    qualification: bool,
) -> Result<()> {
    admin(ctx)?;
    #[cfg(feature = "profile-ticks")]
    if qualification {
        return Err("diagnostic profiling builds cannot qualify capacity".into());
    }
    let mut r = runtime(ctx)?;
    if r.phase != "READY" || r.enabled || market(ctx)?.logical_tick != 0 || r.run_id != 0 {
        return Err("start requires a fresh initialized world".into());
    }
    if profile != "NORMAL" && profile != "CHAOS" {
        return Err("unknown workload profile".into());
    }
    if build_hash.len() != 64 || !build_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("64-character module hash required".into());
    }
    if ctx.db.run_record().count() >= config().detailed_run_retention {
        return Err("prune old evidence through reset batches first".into());
    }
    r.origin = timestamp(
        now_us(ctx)
            .checked_add(1_000_000)
            .ok_or("origin overflow")?,
    );
    r.run_id = r.next_run_id;
    r.next_run_id = add(r.next_run_id, 1)?;
    r.next_slot = 1;
    r.enabled = true;
    r.generation = add(r.generation, 1)?;
    ctx.db.run_record().insert(RunRecord {
        run_id: r.run_id,
        status: "RUNNING".into(),
        failure_reason: String::new(),
        profile: profile.clone(),
        qualification,
        origin: r.origin,
        population: r.initialized,
        seed: r.seed,
        configuration_hash: workload_hash(r.initialized, r.seed, &profile),
        build_hash,
        skipped_slots: 0,
        committed_ticks: 0,
        last_slot: 0,
        last_receipt_at: ctx.timestamp,
        max_lateness_us: 0,
        completed_at: None,
    });
    enqueue(ctx, &r)?;
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

#[reducer]
pub fn pause_simulation(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let mut r = runtime(ctx)?;
    fail_run(ctx, r.run_id, "simulation paused")?;
    r.enabled = false;
    r.generation = add(r.generation, 1)?;
    for row in ctx.db.tick_schedule().iter() {
        ctx.db
            .tick_schedule()
            .scheduled_id()
            .delete(row.scheduled_id);
    }
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

#[reducer]
pub fn recover_simulation(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let mut r = runtime(ctx)?;
    if r.phase != "READY" || r.run_id == 0 {
        return Err("no initialized run to recover".into());
    }
    let mut run = ctx
        .db
        .run_record()
        .run_id()
        .find(r.run_id)
        .ok_or("run missing")?;
    if run.completed_at.is_some() {
        return Err("completed runs cannot resume".into());
    }
    // Explicit owner recovery can adopt new rules without resetting inventory.
    // Preserve the old run hashes: this mixed-version continuation is FAILED,
    // not new benchmark evidence, and its reason records the adopted workload.
    let mut m = market(ctx)?;
    let changed = m.configuration_hash != configuration_hash();
    if changed {
        m.configuration_hash = configuration_hash();
        ctx.db.market_state().id().update(m);
    }
    // Recovery records evidence of interruption and cannot turn FAILED into PASSED.
    run.status = "FAILED".into();
    run.failure_reason =
        if run.configuration_hash != workload_hash(r.initialized, r.seed, &run.profile) {
            format!(
                "authorized non-qualifying recovery after workload change: {}",
                workload_hash(r.initialized, r.seed, &run.profile)
            )
        } else {
            "authorized recovery after pause/stall".into()
        };
    let elapsed = i128::from(now_us(ctx)) - i128::from(r.origin.to_micros_since_unix_epoch());
    let next = if elapsed < 0 {
        1
    } else {
        u64::try_from(elapsed / 50_000 + 1).map_err(|_| "slot overflow")?
    };
    run.skipped_slots = add(run.skipped_slots, next.saturating_sub(r.next_slot))?;
    r.next_slot = next.max(r.next_slot);
    r.enabled = true;
    r.generation = add(r.generation, 1)?;
    for row in ctx.db.tick_schedule().iter() {
        ctx.db
            .tick_schedule()
            .scheduled_id()
            .delete(row.scheduled_id);
    }
    enqueue(ctx, &r)?;
    ctx.db.run_record().run_id().update(run);
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

#[reducer]
pub fn benchmark_step(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let r = runtime(ctx)?;
    if r.enabled {
        return Err("manual stepping forbidden while scheduler enabled".into());
    }
    fail_run(ctx, r.run_id, "manual benchmark step")?;
    execute_tick(ctx, r, false)
}

#[reducer]
pub fn simulation_tick(ctx: &ReducerContext, scheduled: TickSchedule) -> Result<()> {
    if ctx.sender() != ctx.database_identity() {
        return Err("simulation_tick is scheduler-only".into());
    }
    let r = runtime(ctx)?;
    if !r.enabled || scheduled.generation != r.generation || scheduled.intended_slot != r.next_slot
    {
        return Ok(());
    }
    // Delete explicitly as well as runtime's one-shot cleanup; no duplicate next tick.
    ctx.db
        .tick_schedule()
        .scheduled_id()
        .delete(scheduled.scheduled_id);
    execute_tick(ctx, r, true)
}

fn shock(ctx: &ReducerContext, r: &mut RuntimeConfig, tick: u64) -> Result<()> {
    let c = config();
    r.chaos_start = tick;
    r.chaos_end = add(tick, c.chaos_duration_ticks)?;
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
    Ok(())
}

#[reducer]
pub fn trigger_chaos(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    let mut r = runtime(ctx)?;
    if r.phase != "READY" {
        return Err("world is not ready".into());
    }
    fail_run(ctx, r.run_id, "manual shock changed workload")?;
    shock(ctx, &mut r, market(ctx)?.logical_tick)?;
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

fn execute_tick(ctx: &ReducerContext, mut r: RuntimeConfig, scheduled: bool) -> Result<()> {
    let c = config();
    if r.phase != "READY" {
        return Err("world is not ready".into());
    }
    let mut m = market(ctx)?;
    let tick = m.logical_tick;
    // Host-backed timers only in a separate diagnostic release build. Rotate
    // through buckets, sampling one tick per epoch; never log per actor.
    let profiling = cfg!(feature = "profile-ticks") && tick % 20 == (tick / 20) % 20;
    let mut run = ctx
        .db
        .run_record()
        .run_id()
        .find(r.run_id)
        .ok_or("run missing")?;
    if run.completed_at.is_some() {
        return Err("run already ended".into());
    }
    // Do not execute even one new-policy tick under an old workload hash.
    // Commit a stopped/failed state (returning Err would roll it back).
    if m.configuration_hash != configuration_hash() {
        run.status = "FAILED".into();
        if !run
            .failure_reason
            .starts_with("workload configuration changed")
        {
            run.failure_reason = format!(
                "workload configuration changed; explicit recovery required; previous failure: {}",
                run.failure_reason
            );
        }
        ctx.db.run_record().run_id().update(run);
        r.enabled = false;
        r.generation = add(r.generation, 1)?;
        for row in ctx.db.tick_schedule().iter() {
            ctx.db
                .tick_schedule()
                .scheduled_id()
                .delete(row.scheduled_id);
        }
        ctx.db.runtime_config().id().update(r);
        return Ok(());
    }
    let intended = schedule::deadline(r.origin.to_micros_since_unix_epoch(), r.next_slot)?;
    let (next, skipped, lateness) = if scheduled {
        schedule::advance(
            r.origin.to_micros_since_unix_epoch(),
            r.next_slot,
            now_us(ctx),
        )?
    } else {
        (add(r.next_slot, 1)?, 0, 0)
    };
    if skipped > 0 {
        run.status = "FAILED".into();
        run.failure_reason = "missed application slots".into();
    }
    if run.profile == "CHAOS" && r.next_slot >= c.chaos_slot && r.chaos_end == 0 {
        shock(ctx, &mut r, tick)?;
    }
    m.chaos_active = tick >= r.chaos_start && tick < r.chaos_end;
    let signals = Signals {
        momentum_bps: i64::try_from(
            (i128::from(m.price_cents) - i128::from(m.previous_traded_price_cents)) * 10_000
                / i128::from(m.previous_traded_price_cents),
        )
        .map_err(|_| "momentum overflow")?,
        reversion_bps: i64::try_from(
            (i128::from(c.initial_price_cents) - i128::from(m.price_cents)) * 10_000
                / i128::from(m.price_cents),
        )
        .map_err(|_| "reversion overflow")?,
        imbalance_bps: r.imbalance_bps,
        news_bps: if m.chaos_active {
            r.chaos_signal_bps
        } else {
            0
        },
    };
    let bucket = (tick % 20) as u8;
    let timer = profiling
        .then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/indexed-select-sort"));
    // The only actor query in a measured tick is this indexed due-bucket query.
    let mut actors: Vec<_> = ctx.db.actor_state().bucket().filter(bucket).collect();
    actors.sort_unstable_by_key(|a| a.actor_id);
    drop(timer);
    let timer = profiling.then(|| {
        spacetimedb::log_stopwatch::LogStopwatch::new("profile/coverage-policy-lifecycle")
    });
    let manifest = ctx
        .db
        .bucket_manifest()
        .bucket()
        .find(bucket)
        .ok_or("manifest missing")?;
    let mut digest = vec![0; 32];
    let mut orders = vec![];
    let mut actor_orders = vec![None; actors.len()];
    let mut evaluations = 0;
    let mut grants = 0u128;
    let mut grant_count = 0u64;
    let mut activity: Option<(String, String, String, String, u64, i64, u64)> = None;
    for (i, a) in actors.iter_mut().enumerate() {
        let expected_previous = tick.checked_sub(20);
        if a.last_step_tick.get() != expected_previous {
            return Err("missing or duplicate actor update".into());
        }
        digest = extend_digest(&digest, a.actor_id);
        let was_active = a.status == ActorStatus::Active;
        let (grant, transition) = lifecycle::prepare(a, m.price_cents, tick, &c)?;
        grants = grants
            .checked_add(u128::from(grant))
            .ok_or("grant overflow")?;
        if transition == Some("RECAPITALIZED") {
            grant_count = add(grant_count, 1)?;
        }
        if (a.status == ActorStatus::Active) != was_active {
            m.active_actor_count = if a.status == ActorStatus::Active {
                add(m.active_actor_count, 1)?
            } else {
                m.active_actor_count
                    .checked_sub(1)
                    .ok_or("active count underflow")?
            };
        }
        if let Some(event) = transition {
            if activity.is_none() {
                activity = Some((
                    "ACTOR".into(),
                    a.actor_id.to_string(),
                    event.into(),
                    String::new(),
                    0,
                    policy::pnl(
                        a.marked_equity_cents,
                        a.initial_endowment_value_cents,
                        a.cumulative_recapitalization_grants_cents,
                    )?,
                    a.wipeout_count,
                ));
            }
        }
        let intent = if a.status == ActorStatus::Exiting && a.shares > 0 {
            policy::liquidation(a.shares, m.price_cents, &c)?
        } else if a.status == ActorStatus::Active && transition != Some("RECAPITALIZED") {
            evaluations = add(evaluations, 1)?;
            policy::decide(
                Weights {
                    momentum: a.momentum_weight,
                    reversion: a.mean_reversion_weight,
                    contrarian: a.contrarian_weight,
                    news: a.news_weight,
                    conviction: a.conviction_threshold_bps,
                    risk: a.risk_tolerance_bps,
                },
                signals,
                r.seed,
                a.actor_id,
                tick,
                a.cash_cents,
                a.shares,
                m.price_cents,
                &c,
            )?
        } else {
            None
        };
        if let Some((buy, quantity, limit)) = intent {
            actor_orders[i] = Some(orders.len());
            orders.push(Order {
                key: a
                    .actor_id
                    .checked_mul(2)
                    .ok_or("actor order key overflow")?,
                buy,
                quantity,
                limit,
            });
        }
    }
    if manifest.actor_count != actors.len() as u64 || manifest.membership_digest != digest {
        return Err("actor coverage mismatch".into());
    }
    drop(timer);
    let timer =
        profiling.then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/human-gather"));
    let humans: Vec<_> = ctx.db.pending_human_order().iter().collect(); // globally bounded on acceptance
    let human_offset = orders.len();
    for h in &humans {
        orders.push(Order {
            key: h
                .order_key
                .checked_mul(2)
                .and_then(|x| x.checked_add(1))
                .ok_or("human order key overflow")?,
            buy: h.buy,
            quantity: h.quantity,
            limit: h.limit_price_cents,
        });
    }
    drop(timer);
    let timer = profiling.then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/auction"));
    let clearing = auction::clear(&orders, m.price_cents, mix(r.seed ^ tick))?;
    drop(timer);
    let timer = profiling
        .then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/actor-settle-final-write"));
    let mut filled_orders = 0;
    for (i, a) in actors.iter_mut().enumerate() {
        if let Some(oi) = actor_orders[i] {
            let filled = clearing.fills[oi];
            if filled > 0 {
                (a.cash_cents, a.shares) = policy::settle(
                    a.cash_cents,
                    a.shares,
                    orders[oi].buy,
                    filled,
                    clearing.price,
                )?;
                a.filled_order_count = add(a.filled_order_count, 1)?;
                filled_orders = add(filled_orders, 1)?;
                if activity.is_none() {
                    activity = Some((
                        "ACTOR".into(),
                        a.actor_id.to_string(),
                        "FILLED".into(),
                        if orders[oi].buy { "BUY" } else { "SELL" }.into(),
                        filled,
                        0,
                        a.wipeout_count,
                    ));
                }
            }
        }
        lifecycle::finish(a, tick, clearing.price)?;
        if a.actor_id <= c.sample_size {
            lifecycle::sample(ctx, a);
        }
        // Exactly one final actor row write, including PASS/EXITING/COOLDOWN.
        ctx.db.actor_state().actor_id().update(a.clone());
    }
    drop(timer);
    let timer =
        profiling.then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/human-settle"));
    for (i, pending) in humans.iter().enumerate() {
        let filled = clearing.fills[human_offset + i];
        let mut h = ctx
            .db
            .human_trader()
            .identity()
            .find(pending.identity)
            .ok_or("pending trader missing")?;
        (h.cash_cents, h.shares) =
            policy::settle(h.cash_cents, h.shares, pending.buy, filled, clearing.price)?;
        h.reserved_cash_cents = 0;
        h.reserved_shares = 0;
        h.pnl_cents = policy::pnl(
            equity(h.cash_cents, h.shares, clearing.price)?,
            c.bankroll_cents,
            0,
        )?;
        h.completed_orders = add(h.completed_orders, 1)?;
        if filled > 0 {
            filled_orders = add(filled_orders, 1)?;
        }
        let key = format!("{}:{}", h.identity, h.completed_orders);
        ctx.db.human_order_receipt().insert(HumanOrderReceipt {
            key,
            identity: h.identity,
            client_order_id: pending.client_order_id,
            sequence: h.completed_orders,
            logical_tick: tick,
            buy: pending.buy,
            requested_quantity: pending.quantity,
            filled_quantity: filled,
            price_cents: clearing.price,
            status: if filled == 0 {
                "EXPIRED"
            } else if filled < pending.quantity {
                "PARTIAL"
            } else {
                "FILLED"
            }
            .into(),
            recorded_at: ctx.timestamp,
        });
        if h.completed_orders > c.human_receipt_retention {
            ctx.db.human_order_receipt().key().delete(format!(
                "{}:{}",
                h.identity,
                h.completed_orders - c.human_receipt_retention
            ));
        }
        ctx.db.human_trader().identity().update(h);
        ctx.db
            .pending_human_order()
            .identity()
            .delete(pending.identity);
        if filled > 0 && activity.is_none() {
            activity = Some((
                "HUMAN".into(),
                pending.identity.to_string(),
                "FILLED".into(),
                if pending.buy { "BUY" } else { "SELL" }.into(),
                filled,
                0,
                0,
            ));
        }
    }
    #[cfg(feature = "test-support")]
    crate::test_support::check_fault(ctx)?;
    drop(timer);
    let _timer = profiling.then(|| {
        spacetimedb::log_stopwatch::LogStopwatch::new("profile/feeds-receipts-scheduling")
    });

    let mut accounting = ctx
        .db
        .grant_accounting()
        .id()
        .find(0)
        .ok_or("accounting missing")?;
    accounting.recapitalization_cash_cents = accounting
        .recapitalization_cash_cents
        .checked_add(grants)
        .ok_or("grant accounting overflow")?;
    accounting.recapitalization_count = add(accounting.recapitalization_count, grant_count)?;
    if grant_count > 0 {
        ctx.db.grant_accounting().id().update(accounting);
    }
    if let Some((
        participant_type,
        participant_id,
        event_kind,
        side,
        quantity,
        lifetime_pnl_cents,
        wipeout_count,
    )) = activity
    {
        if i128::from(now_us(ctx)) - i128::from(r.last_activity_at.to_micros_since_unix_epoch())
            >= i128::from(c.activity_interval_us)
        {
            let id = r.next_activity_id;
            r.next_activity_id = add(id, 1)?;
            r.last_activity_at = ctx.timestamp;
            ctx.db.public_activity().insert(PublicActivity {
                id,
                logical_tick: tick,
                recorded_at: ctx.timestamp,
                participant_type,
                participant_id,
                event_kind,
                side,
                quantity,
                price_cents: clearing.price,
                lifetime_pnl_cents,
                wipeout_count,
            });
            if id > c.activity_retention {
                ctx.db
                    .public_activity()
                    .id()
                    .delete(id - c.activity_retention);
            }
        }
    }
    let buys: u128 = orders
        .iter()
        .filter(|o| o.buy)
        .map(|o| u128::from(o.quantity))
        .sum();
    let sells: u128 = orders
        .iter()
        .filter(|o| !o.buy)
        .map(|o| u128::from(o.quantity))
        .sum();
    r.imbalance_bps = if buys + sells == 0 {
        0
    } else {
        i64::try_from(
            (i128::try_from(buys).map_err(|_| "quantity overflow")?
                - i128::try_from(sells).map_err(|_| "quantity overflow")?)
                * 10_000
                / i128::try_from(buys + sells).map_err(|_| "quantity overflow")?,
        )
        .map_err(|_| "imbalance overflow")?
    };
    let steps = actors.len() as u64;
    m.previous_traded_price_cents = m.price_cents;
    m.volatility_bps = u64::try_from(
        u128::from(clearing.price.abs_diff(m.price_cents)) * 10_000 / u128::from(m.price_cents),
    )
    .map_err(|_| "volatility overflow")?;
    m.price_cents = clearing.price;
    m.price = clearing.price;
    m.logical_tick = add(tick, 1)?;
    m.tick = m.logical_tick;
    m.epoch = m.logical_tick / 20;
    m.matched_share_volume = clearing.volume;
    m.cumulative_actor_steps = add(m.cumulative_actor_steps, steps)?;
    m.cumulative_actor_rows_updated = add(m.cumulative_actor_rows_updated, steps)?;
    m.cumulative_policy_evaluations = add(m.cumulative_policy_evaluations, evaluations)?;
    m.cumulative_orders_submitted = add(m.cumulative_orders_submitted, orders.len() as u64)?;
    m.cumulative_orders_filled = add(m.cumulative_orders_filled, filled_orders)?;
    m.cumulative_matched_share_volume = add(m.cumulative_matched_share_volume, clearing.volume)?;
    if i128::from(now_us(ctx)) - i128::from(m.rate_window_started_at.to_micros_since_unix_epoch())
        >= i128::from(c.rate_window_us)
    {
        m.rate_window_started_at = m.rate_window_ended_at;
    }
    m.rate_window_ended_at = ctx.timestamp;
    ctx.db.market_state().id().update(m);
    ctx.db.price_point().insert(PricePoint {
        logical_tick: tick,
        recorded_at: ctx.timestamp,
        price_cents: clearing.price,
        matched_share_volume: clearing.volume,
    });
    if tick >= c.price_retention {
        ctx.db
            .price_point()
            .logical_tick()
            .delete(tick - c.price_retention);
    }
    run.committed_ticks = add(run.committed_ticks, 1)?;
    run.last_slot = r.next_slot;
    run.last_receipt_at = ctx.timestamp;
    run.skipped_slots = add(run.skipped_slots, skipped)?;
    run.max_lateness_us = run.max_lateness_us.max(lateness);
    ctx.db.detailed_benchmark_receipts().insert(TickReceipt {
        key: format!("{}:{}", r.run_id, run.committed_ticks),
        run_id: r.run_id,
        intended_slot: r.next_slot,
        logical_tick: tick,
        intended_at: timestamp(intended),
        invoked_at: ctx.timestamp,
        start_lateness_us: lateness,
        skipped_slots: skipped,
        schedule_debt_us: lateness,
        bucket,
        actor_steps: steps,
        policy_evaluations: evaluations,
        actor_rows_updated: steps,
        membership_digest: digest,
        previous_steps_valid: true,
        orders_submitted: orders.len() as u64,
        orders_filled: filled_orders,
        matched_share_volume: clearing.volume,
    });
    if run.committed_ticks > c.tick_receipt_retention {
        ctx.db.detailed_benchmark_receipts().key().delete(format!(
            "{}:{}",
            r.run_id,
            run.committed_ticks - c.tick_receipt_retention
        ));
    }
    r.next_slot = next;
    if run.qualification && r.next_slot > (c.warmup_seconds + c.measurement_seconds) * 20 {
        r.enabled = false;
        run.completed_at = Some(ctx.timestamp);
        if run.status != "FAILED" {
            run.status = "INCONCLUSIVE".into();
            run.failure_reason = "awaiting harness evidence validation".into();
        }
    }
    if scheduled && r.enabled {
        enqueue(ctx, &r)?;
    }
    ctx.db.run_record().run_id().update(run);
    ctx.db.runtime_config().id().update(r);
    Ok(())
}
