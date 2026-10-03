use spacetimedb::{reducer, table, ReducerContext, ScheduleAt, Table};
use std::time::Duration;

const MARKET_ID: u8 = 0;

/// The initial client contract. Price is an integer number of cents.
#[table(accessor = market_state, public)]
pub struct MarketState {
    #[primary_key]
    pub id: u8,
    pub tick: u64,
    pub price: u64,
    pub actor_count: u64,
}

#[table(accessor = tick_schedule, scheduled(simulation_tick))]
pub struct TickSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.market_state().insert(MarketState {
        id: MARKET_ID,
        tick: 0,
        price: 10_000,
        actor_count: 0,
    });
    ctx.db.tick_schedule().insert(TickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(Duration::from_millis(50).into()),
    });
}

#[reducer]
pub fn simulation_tick(ctx: &ReducerContext, _schedule: TickSchedule) -> Result<(), String> {
    // Also exclude manual owner/collaborator calls from this clock.
    if ctx.sender() != ctx.database_identity() {
        return Err("simulation_tick is scheduler-only".into());
    }
    let mut state = ctx
        .db
        .market_state()
        .id()
        .find(MARKET_ID)
        .ok_or("market state is missing")?;
    state.tick = state.tick.checked_add(1).ok_or("tick counter overflow")?;
    ctx.db.market_state().id().update(state);
    Ok(())
}

/// Exercises the public reducer path without implementing trading behavior.
#[reducer]
pub fn ping(_ctx: &ReducerContext) {}
