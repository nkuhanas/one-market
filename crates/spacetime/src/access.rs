use crate::schema::*;
use one_market_core::Result;
use spacetimedb::{reducer, view, Identity, ReducerContext, Table, ViewContext};

pub fn admin(ctx: &ReducerContext) -> Result<()> {
    if ctx
        .db
        .admin_allowlist()
        .identity()
        .find(ctx.sender())
        .is_none()
    {
        return Err("admin authorization required".into());
    }
    Ok(())
}

#[reducer]
pub fn authorize_reader(ctx: &ReducerContext, identity: Identity) -> Result<()> {
    admin(ctx)?;
    if ctx
        .db
        .benchmark_reader()
        .identity()
        .find(identity)
        .is_none()
    {
        ctx.db
            .benchmark_reader()
            .insert(BenchmarkReader { identity });
    }
    Ok(())
}

#[view(accessor = my_trader, public)]
pub fn my_trader(ctx: &ViewContext) -> Option<HumanTrader> {
    let mut trader = ctx.db.human_trader().identity().find(ctx.sender())?;
    let market = ctx.db.market_state().id().find(0)?;
    trader.pnl_cents = one_market_core::policy::pnl(
        one_market_core::equity(trader.cash_cents, trader.shares, market.price_cents).ok()?,
        one_market_core::config::config().bankroll_cents,
        0,
    )
    .ok()?;
    Some(trader)
}

#[view(accessor = my_pending_order, public)]
pub fn my_pending_order(ctx: &ViewContext) -> Option<PendingHumanOrder> {
    ctx.db.pending_human_order().identity().find(ctx.sender())
}

#[view(accessor = my_recent_fills, public)]
pub fn my_recent_fills(ctx: &ViewContext) -> Vec<HumanOrderReceipt> {
    ctx.db
        .human_order_receipt()
        .identity()
        .filter(ctx.sender())
        .collect()
}

// O(1) live path for an explicitly authorized reader. The database owner can
// also export retained evidence through authenticated SQL/private subscriptions.
#[view(accessor = benchmark_latest_receipt, public)]
pub fn benchmark_latest_receipt(ctx: &ViewContext) -> Option<TickReceipt> {
    ctx.db.benchmark_reader().identity().find(ctx.sender())?;
    let runtime = ctx.db.runtime_config().id().find(0)?;
    let run = ctx.db.run_record().run_id().find(runtime.run_id)?;
    ctx.db
        .detailed_benchmark_receipts()
        .key()
        .find(format!("{}:{}", run.run_id, run.committed_ticks))
}

#[view(accessor = benchmark_runs, public)]
pub fn benchmark_runs(ctx: &ViewContext) -> Vec<RunRecord> {
    if ctx
        .db
        .benchmark_reader()
        .identity()
        .find(ctx.sender())
        .is_none()
    {
        return vec![];
    }
    let Some(runtime) = ctx.db.runtime_config().id().find(0) else {
        return vec![];
    };
    (runtime.next_run_id.saturating_sub(6)..runtime.next_run_id)
        .filter_map(|id| ctx.db.run_record().run_id().find(id))
        .collect()
}

#[reducer(client_connected)]
pub fn connected(ctx: &ReducerContext) -> Result<()> {
    let Some(connection_id) = ctx.connection_id() else {
        return Ok(());
    };
    let first = ctx
        .db
        .connection_state()
        .identity()
        .filter(ctx.sender())
        .next()
        .is_none();
    ctx.db.connection_state().insert(ConnectionState {
        connection_id,
        identity: ctx.sender(),
    });
    if first {
        let mut market = crate::market(ctx)?;
        market.connected_identity_count = one_market_core::add(market.connected_identity_count, 1)?;
        ctx.db.market_state().id().update(market);
    }
    Ok(())
}

#[reducer(client_disconnected)]
pub fn disconnected(ctx: &ReducerContext) -> Result<()> {
    let Some(id) = ctx.connection_id() else {
        return Ok(());
    };
    if !ctx.db.connection_state().connection_id().delete(id) {
        return Ok(());
    }
    if ctx
        .db
        .connection_state()
        .identity()
        .filter(ctx.sender())
        .next()
        .is_none()
    {
        let mut market = crate::market(ctx)?;
        market.connected_identity_count = market
            .connected_identity_count
            .checked_sub(1)
            .ok_or("connection count underflow")?;
        ctx.db.market_state().id().update(market);
    }
    Ok(())
}
