use crate::{market, now_us, runtime, schema::*};
use one_market_core::{add, config::config, mul, Result};
use spacetimedb::{reducer, ReducerContext, Table};

#[reducer]
pub fn enter_market(ctx: &ReducerContext) -> Result<()> {
    if ctx
        .db
        .human_trader()
        .identity()
        .find(ctx.sender())
        .is_some()
    {
        return Ok(());
    }
    if runtime(ctx)?.phase != "READY" {
        return Err("world initialization is incomplete".into());
    }
    let c = config();
    ctx.db.human_trader().insert(HumanTrader {
        identity: ctx.sender(),
        cash_cents: c.human_bankroll_cents,
        shares: 0,
        reserved_cash_cents: 0,
        reserved_shares: 0,
        pnl_cents: 0,
        created_at: ctx.timestamp,
        last_order_at: None,
        completed_orders: 0,
    });
    let mut m = market(ctx)?;
    m.registered_human_trader_count = add(m.registered_human_trader_count, 1)?;
    ctx.db.market_state().id().update(m);
    let mut g = ctx
        .db
        .grant_accounting()
        .id()
        .find(0)
        .ok_or("accounting missing")?;
    g.human_entry_cash_cents = g
        .human_entry_cash_cents
        .checked_add(c.human_bankroll_cents.into())
        .ok_or("grant overflow")?;
    g.human_entry_count = add(g.human_entry_count, 1)?;
    ctx.db.grant_accounting().id().update(g);
    Ok(())
}

#[reducer]
pub fn place_order(
    ctx: &ReducerContext,
    client_order_id: u64,
    side: String,
    quantity: u64,
    limit_price_cents: u64,
) -> Result<()> {
    let mut r = runtime(ctx)?;
    if r.phase != "READY" {
        return Err("world is not ready".into());
    }
    if client_order_id == 0
        || ctx
            .db
            .order_watermark()
            .identity()
            .find(ctx.sender())
            .is_some_and(|w| client_order_id <= w.client_order_id)
    {
        return Err("duplicate or replayed client order ID".into());
    }
    let c = config();
    let buy = match side.as_str() {
        "BUY" => true,
        "SELL" => false,
        _ => return Err("side must be BUY or SELL".into()),
    };
    if quantity == 0
        || quantity > c.human_max_quantity
        || !(c.min_price_cents..=c.max_price_cents).contains(&limit_price_cents)
    {
        return Err("quantity or limit outside permitted range".into());
    }
    if ctx
        .db
        .pending_human_order()
        .identity()
        .find(ctx.sender())
        .is_some()
    {
        return Err("one pending order per identity".into());
    }
    if ctx.db.pending_human_order().count() >= c.pending_order_max {
        return Err("pending order capacity reached".into());
    }
    let mut h = ctx
        .db
        .human_trader()
        .identity()
        .find(ctx.sender())
        .ok_or("enter market first")?;
    if h.last_order_at.is_some_and(|t| {
        i128::from(now_us(ctx)) - i128::from(t.to_micros_since_unix_epoch())
            < i128::from(c.human_interval_us)
    }) {
        return Err("order rate limit".into());
    }
    if buy {
        let reservation = mul(quantity, limit_price_cents)?;
        if reservation
            > h.cash_cents
                .checked_sub(h.reserved_cash_cents)
                .ok_or("invalid cash reservation")?
        {
            return Err("insufficient available cash".into());
        }
        h.reserved_cash_cents = add(h.reserved_cash_cents, reservation)?;
    } else {
        if quantity
            > h.shares
                .checked_sub(h.reserved_shares)
                .ok_or("invalid share reservation")?
        {
            return Err("insufficient available shares".into());
        }
        h.reserved_shares = add(h.reserved_shares, quantity)?;
    }
    h.last_order_at = Some(ctx.timestamp);
    ctx.db.human_trader().identity().update(h);
    ctx.db.pending_human_order().insert(PendingHumanOrder {
        identity: ctx.sender(),
        order_key: r.next_order_key,
        client_order_id,
        buy,
        quantity,
        limit_price_cents,
        accepted_at: ctx.timestamp,
    });
    r.next_order_key = add(r.next_order_key, 1)?;
    ctx.db.runtime_config().id().update(r);
    let watermark = OrderWatermark {
        identity: ctx.sender(),
        client_order_id,
    };
    if ctx
        .db
        .order_watermark()
        .identity()
        .find(ctx.sender())
        .is_some()
    {
        ctx.db.order_watermark().identity().update(watermark);
    } else {
        ctx.db.order_watermark().insert(watermark);
    }
    Ok(())
}
