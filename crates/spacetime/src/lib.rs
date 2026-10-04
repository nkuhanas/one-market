mod access;
mod humans;
mod lifecycle;
#[cfg(test)]
mod market_regressions;
mod qualification;
mod revival;
mod runtime;
mod schema;
mod setup;
#[cfg(feature = "test-support")]
mod test_support;

use one_market_core::{config::config, Result};
pub use runtime::simulation_tick;
use schema::*;
use spacetimedb::{reducer, ReducerContext, Table, Timestamp};

fn market(ctx: &ReducerContext) -> Result<MarketState> {
    ctx.db
        .market_state()
        .id()
        .find(0)
        .ok_or_else(|| "market missing".into())
}

fn runtime(ctx: &ReducerContext) -> Result<RuntimeConfig> {
    ctx.db
        .runtime_config()
        .id()
        .find(0)
        .ok_or_else(|| "runtime missing".into())
}

fn now_us(ctx: &ReducerContext) -> i64 {
    ctx.timestamp.to_micros_since_unix_epoch()
}
fn timestamp(micros: i64) -> Timestamp {
    Timestamp::from_micros_since_unix_epoch(micros)
}

fn fresh_market(now: Timestamp, connected: u64) -> MarketState {
    let c = config();
    MarketState {
        id: 0,
        tick: 0,
        price: c.initial_price_cents,
        logical_tick: 0,
        epoch: 0,
        price_cents: c.initial_price_cents,
        previous_traded_price_cents: c.initial_price_cents,
        matched_share_volume: 0,
        volatility_bps: 0,
        actor_count: 0,
        active_actor_count: 0,
        registered_human_trader_count: 0,
        connected_identity_count: connected,
        cumulative_actor_steps: 0,
        cumulative_policy_evaluations: 0,
        cumulative_actor_rows_updated: 0,
        cumulative_orders_submitted: 0,
        cumulative_orders_filled: 0,
        cumulative_matched_share_volume: 0,
        rate_window_us: c.rate_window_us,
        rate_window_started_at: now,
        rate_window_ended_at: now,
        chaos_active: false,
        phase: "EMPTY".into(),
        configuration_hash: one_market_core::config::configuration_hash(),
    }
}

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.admin_allowlist().insert(AdminAllowlist {
        identity: ctx.sender(),
    });
    ctx.db.benchmark_reader().insert(BenchmarkReader {
        identity: ctx.sender(),
    });
    ctx.db.market_state().insert(fresh_market(ctx.timestamp, 0));
    revival::ensure(ctx, config().initial_price_cents);
    ctx.db.runtime_config().insert(RuntimeConfig {
        id: 0,
        phase: "EMPTY".into(),
        target_population: 0,
        initialized: 0,
        seed: config().seed,
        generation: 0,
        enabled: false,
        origin: ctx.timestamp,
        next_slot: 0,
        run_id: 0,
        next_run_id: 1,
        next_order_key: 1,
        next_activity_id: 1,
        next_news_id: 1,
        last_activity_at: timestamp(0),
        imbalance_bps: 0,
        chaos_start: 0,
        chaos_end: 0,
        chaos_signal_bps: 0,
    });
    ctx.db.grant_accounting().insert(GrantAccounting {
        id: 0,
        actor_initial_cash_cents: 0,
        human_entry_cash_cents: 0,
        recapitalization_cash_cents: 0,
        initial_share_supply: 0,
        human_entry_count: 0,
        recapitalization_count: 0,
    });
    for bucket in 0..20 {
        ctx.db.bucket_manifest().insert(BucketManifest {
            bucket,
            actor_count: 0,
            membership_digest: vec![0; 32],
        });
    }
}

#[reducer]
pub fn ping(_ctx: &ReducerContext) {}
