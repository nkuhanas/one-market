use crate::{
    access::admin, lifecycle, market, now_us, revival, runtime, schema::*, timestamp, timing,
};
use one_market_core::{
    add,
    auction::{self, Order},
    config::{config, configuration_hash, workload_hash_at_cadence},
    equity, extend_digest, mix,
    policy::{self, PolicyTick, Signals, Weights},
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

fn enqueue(ctx: &ReducerContext, r: &RuntimeConfig, interval_us: u64) -> Result<()> {
    ctx.db.tick_schedule().insert(TickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(timestamp(schedule::deadline(
            r.origin.to_micros_since_unix_epoch(),
            r.next_slot,
            interval_us,
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
    let m = market(ctx)?;
    if r.phase != "READY" || r.enabled || r.run_id != 0 {
        return Err(
            "start requires a fresh initialized world or an explicitly selected new cadence".into(),
        );
    }
    if qualification
        && (m.logical_tick != 0
            || ctx
                .db
                .cadence_state()
                .id()
                .find(0)
                .is_some_and(|s| s.requires_explicit_start))
    {
        return Err("qualification requires a fresh initialized world".into());
    }
    if m.configuration_hash != configuration_hash() {
        return Err("explicit workload adoption required".into());
    }
    if profile != "NORMAL" && profile != "CHAOS" {
        return Err("unknown workload profile".into());
    }
    revival::ensure(ctx, market(ctx)?.price_cents);
    timing::ensure(ctx);
    let c = config();
    let cadence = timing::selected(ctx, &c)?;
    if build_hash.len() != 64 || !build_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("64-character module hash required".into());
    }
    if ctx.db.run_record().count() >= config().detailed_run_retention {
        return Err("archive and explicitly prune completed run evidence first".into());
    }
    crate::timed_run::clear(ctx);
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
    ctx.db.run_cadence().insert(RunCadence {
        run_id: r.run_id,
        profile: cadence.id.clone(),
        tick_interval_us: cadence.tick_interval_us,
        bucket_count: c.buckets,
        first_logical_tick: m.logical_tick,
    });
    ctx.db.run_record().insert(RunRecord {
        run_id: r.run_id,
        status: "RUNNING".into(),
        failure_reason: String::new(),
        profile: profile.clone(),
        qualification,
        origin: r.origin,
        population: r.initialized,
        seed: r.seed,
        configuration_hash: workload_hash_at_cadence(r.initialized, r.seed, &profile, &cadence),
        build_hash,
        skipped_slots: 0,
        committed_ticks: 0,
        last_slot: 0,
        last_receipt_at: ctx.timestamp,
        max_lateness_us: 0,
        completed_at: None,
    });
    let mut state = ctx
        .db
        .cadence_state()
        .id()
        .find(0)
        .ok_or("cadence missing")?;
    state.requires_explicit_start = false;
    ctx.db.cadence_state().id().update(state);
    enqueue(ctx, &r, cadence.tick_interval_us)?;
    ctx.db.runtime_config().id().update(r);
    Ok(())
}

#[reducer]
pub fn pause_simulation(ctx: &ReducerContext) -> Result<()> {
    admin(ctx)?;
    pause(ctx, "simulation paused")
}

pub(crate) fn pause(ctx: &ReducerContext, reason: &str) -> Result<()> {
    let mut r = runtime(ctx)?;
    fail_run(ctx, r.run_id, reason)?;
    r.enabled = false;
    r.generation = add(r.generation, 1)?;
    crate::timed_run::clear(ctx);
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
    crate::timed_run::clear(ctx);
    // Explicit owner recovery can adopt new rules without resetting inventory.
    // Preserve the old run hashes: this mixed-version continuation is FAILED,
    // not new benchmark evidence, and its reason records the adopted workload.
    let mut m = market(ctx)?;
    let changed = m.configuration_hash != configuration_hash();
    if changed {
        revival::ensure(ctx, m.price_cents);
        m.configuration_hash = configuration_hash();
        ctx.db.market_state().id().update(m);
    }
    timing::ensure(ctx);
    let cadence = timing::for_run(ctx, r.run_id, &config())?;
    // Recovery records evidence of interruption and cannot turn FAILED into PASSED.
    run.status = "FAILED".into();
    let recovery_reason = if run.configuration_hash
        != workload_hash_at_cadence(r.initialized, r.seed, &run.profile, &cadence)
    {
        format!(
            "authorized non-qualifying recovery after workload change: {}",
            workload_hash_at_cadence(r.initialized, r.seed, &run.profile, &cadence)
        )
    } else {
        "authorized recovery after pause/stall".into()
    };
    if !run.failure_reason.contains(&recovery_reason) {
        if !run.failure_reason.is_empty() {
            run.failure_reason.push_str("; ");
        }
        run.failure_reason.push_str(&recovery_reason);
    }
    let next = schedule::next_slot(
        r.origin.to_micros_since_unix_epoch(),
        now_us(ctx),
        cadence.tick_interval_us,
    )?;
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
    enqueue(ctx, &r, cadence.tick_interval_us)?;
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
    if crate::timed_run::stop_if_due(ctx, &r)? {
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
    let buckets = u64::from(c.buckets);
    let profiling = cfg!(feature = "profile-ticks") && tick % buckets == (tick / buckets) % buckets;
    // Host clock span: excludes transaction commit/replication after return.
    let _whole_timer =
        profiling.then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/tick-body"));
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
    let cadence = timing::for_run(ctx, r.run_id, &c)?;
    let intended = schedule::deadline(
        r.origin.to_micros_since_unix_epoch(),
        r.next_slot,
        cadence.tick_interval_us,
    )?;
    let (next, skipped, lateness) = if scheduled {
        schedule::advance(
            r.origin.to_micros_since_unix_epoch(),
            r.next_slot,
            now_us(ctx),
            cadence.tick_interval_us,
        )?
    } else {
        (add(r.next_slot, 1)?, 0, 0)
    };
    if skipped > 0 {
        run.status = "FAILED".into();
        if !run.failure_reason.contains("missed application slots") {
            if !run.failure_reason.is_empty() {
                run.failure_reason.push_str("; ");
            }
            run.failure_reason.push_str("missed application slots");
        }
    }
    if run.profile == "CHAOS" && r.next_slot >= c.chaos_slot && r.chaos_end == 0 {
        shock(ctx, &mut r, tick)?;
    }
    m.chaos_active = tick >= r.chaos_start && tick < r.chaos_end;
    let mut dynamics = ctx
        .db
        .market_dynamics()
        .id()
        .find(0)
        .ok_or("market dynamics missing; explicit workload adoption required")?;
    revival::advance_reference(&mut dynamics, r.seed, tick, &c)?;
    let signals = Signals {
        momentum_bps: i64::try_from(
            (i128::from(m.price_cents) - i128::from(m.previous_traded_price_cents)) * 10_000
                / i128::from(m.previous_traded_price_cents),
        )
        .map_err(|_| "momentum overflow")?,
        reference_price_cents: dynamics.reference_price_cents,
        sentiment_bps: dynamics.sentiment_bps,
        imbalance_bps: r.imbalance_bps,
        news_bps: if m.chaos_active {
            r.chaos_signal_bps
        } else {
            0
        },
    };
    let bucket = (tick % buckets) as u8;
    let policy_tick = PolicyTick::new(signals, r.seed, tick, m.price_cents, &c);
    let timer = profiling
        .then(|| spacetimedb::log_stopwatch::LogStopwatch::new("profile/indexed-select-sort"));
    // Only indexed due-bucket reads, from each nonempty actor representation.
    let mut actors = crate::actor_storage::load_bucket(ctx, bucket)?;
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
        let expected_previous = tick.checked_sub(buckets);
        if a.last_step_tick.get() != expected_previous {
            return Err("missing or duplicate actor update".into());
        }
        digest = extend_digest(&digest, a.actor_id);
        let was_active = a.status == ActorStatus::Active;
        let (mut grant, mut transition) = lifecycle::prepare(a, m.price_cents, tick, &c)?;
        if a.status == ActorStatus::Exiting {
            let previous = ctx.db.actor_recovery().actor_id().find(a.actor_id);
            let mut record = previous.clone().unwrap_or(ActorRecovery {
                actor_id: a.actor_id,
                exit_started_tick: tick,
                last_episode: 0,
                grants_cents: 0,
            });
            if was_active {
                record.exit_started_tick = tick;
            }
            if let Some(support) = revival::try_revive(
                a,
                &mut record,
                &mut dynamics,
                i,
                tick,
                m.price_cents,
                r.initialized,
                &c,
            )? {
                grant = add(grant, support)?;
                transition = Some("REVIVED — INVENTORY RETAINED");
            }
            if previous.as_ref() != Some(&record) {
                if previous.is_some() {
                    ctx.db.actor_recovery().actor_id().update(record);
                } else {
                    ctx.db.actor_recovery().insert(record);
                }
            }
        }
        grants = grants
            .checked_add(u128::from(grant))
            .ok_or("grant overflow")?;
        if transition == Some("RECAPITALIZED") || transition == Some("REVIVED — INVENTORY RETAINED")
        {
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
        } else if a.status == ActorStatus::Active
            && transition != Some("RECAPITALIZED")
            && transition != Some("REVIVED — INVENTORY RETAINED")
        {
            evaluations = add(evaluations, 1)?;
            policy_tick.decide(
                Weights {
                    momentum: a.momentum_weight,
                    reversion: a.mean_reversion_weight,
                    contrarian: a.contrarian_weight,
                    news: a.news_weight,
                    conviction: a.conviction_threshold_bps,
                    risk: a.risk_tolerance_bps,
                },
                a.actor_id,
                a.cash_cents,
                a.shares,
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
    let steps = actors.len() as u64;
    let mut active_in_bucket = 0u64;
    for (i, mut a) in actors.into_iter().enumerate() {
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
        lifecycle::finish(&mut a, tick, clearing.price)?;
        if a.actor_id <= c.sample_size {
            lifecycle::sample(ctx, &a);
        }
        active_in_bucket += u64::from(a.status == ActorStatus::Active);
        // Exactly one final actor row write, including PASS/EXITING/COOLDOWN.
        crate::actor_storage::update(ctx, a);
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
    m.previous_traded_price_cents = m.price_cents;
    m.volatility_bps = u64::try_from(
        u128::from(clearing.price.abs_diff(m.price_cents)) * 10_000 / u128::from(m.price_cents),
    )
    .map_err(|_| "volatility overflow")?;
    m.price_cents = clearing.price;
    m.price = clearing.price;
    m.logical_tick = add(tick, 1)?;
    m.tick = m.logical_tick;
    m.epoch = m.logical_tick / buckets;
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
    let mut health = ctx
        .db
        .bucket_health()
        .bucket()
        .find(bucket)
        .ok_or("bucket health missing")?;
    revival::observe(
        &mut dynamics,
        &mut health,
        tick,
        clearing.price,
        clearing.volume,
        m.active_actor_count,
        r.initialized,
        active_in_bucket,
        steps,
        &c,
    )?;
    ctx.db.market_dynamics().id().update(dynamics);
    ctx.db.bucket_health().bucket().update(health);
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
    if run.qualification
        && r.next_slot > cadence.ticks_for_seconds(c.warmup_seconds + c.measurement_seconds)?
    {
        r.enabled = false;
        run.completed_at = Some(ctx.timestamp);
        if run.status != "FAILED" {
            run.status = "INCONCLUSIVE".into();
            run.failure_reason = "awaiting harness evidence validation".into();
        }
    }
    if scheduled && r.enabled {
        enqueue(ctx, &r, cadence.tick_interval_us)?;
    }
    ctx.db.run_record().run_id().update(run);
    ctx.db.runtime_config().id().update(r);
    Ok(())
}
