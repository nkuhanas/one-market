//! One authoritative row per actor, with a lossless fixed-width fast path.
use crate::{access::admin, runtime, schema::*};
use one_market_core::{config::config, Result};
use spacetimedb::{reducer, ReducerContext, Table};
use std::ops::{Deref, DerefMut};

impl ActorStateCompact {
    pub(crate) fn pack(a: &ActorState) -> Option<Self> {
        Some(Self {
            actor_id: a.actor_id,
            bucket: a.bucket,
            flags: match a.status {
                ActorStatus::Active => 0,
                ActorStatus::Exiting => 1,
                ActorStatus::Cooldown => 2,
            } | (u8::from(a.last_step_tick.present) << 2)
                | (u8::from(a.cooldown_started_tick.present) << 3),
            cash_cents: a.cash_cents.try_into().ok()?,
            shares: a.shares.try_into().ok()?,
            marked_equity_cents: a.marked_equity_cents.try_into().ok()?,
            initial_endowment_value_cents: a.initial_endowment_value_cents.try_into().ok()?,
            life_peak_equity_cents: a.life_peak_equity_cents.try_into().ok()?,
            cumulative_recapitalization_grants_cents: a
                .cumulative_recapitalization_grants_cents
                .try_into()
                .ok()?,
            momentum_weight: a.momentum_weight.try_into().ok()?,
            mean_reversion_weight: a.mean_reversion_weight.try_into().ok()?,
            contrarian_weight: a.contrarian_weight.try_into().ok()?,
            news_weight: a.news_weight.try_into().ok()?,
            risk_tolerance_bps: a.risk_tolerance_bps.try_into().ok()?,
            conviction_threshold_bps: a.conviction_threshold_bps.try_into().ok()?,
            last_step_tick_value: a.last_step_tick.value,
            cooldown_started_tick_value: a.cooldown_started_tick.value,
            lifetime_pnl_cents: a.lifetime_pnl_cents.try_into().ok()?,
            wipeout_count: a.wipeout_count.try_into().ok()?,
            filled_order_count: a.filled_order_count.try_into().ok()?,
        })
    }

    pub(crate) fn unpack(self) -> Result<ActorState> {
        if self.flags & !0x0f != 0 {
            return Err("invalid compact actor flags".into());
        }
        Ok(ActorState {
            actor_id: self.actor_id,
            bucket: self.bucket,
            status: match self.flags & 3 {
                0 => ActorStatus::Active,
                1 => ActorStatus::Exiting,
                2 => ActorStatus::Cooldown,
                _ => return Err("invalid compact actor status".into()),
            },
            cash_cents: self.cash_cents.into(),
            shares: self.shares.into(),
            marked_equity_cents: self.marked_equity_cents.into(),
            initial_endowment_value_cents: self.initial_endowment_value_cents.into(),
            life_peak_equity_cents: self.life_peak_equity_cents.into(),
            cumulative_recapitalization_grants_cents: self
                .cumulative_recapitalization_grants_cents
                .into(),
            momentum_weight: self.momentum_weight.into(),
            mean_reversion_weight: self.mean_reversion_weight.into(),
            contrarian_weight: self.contrarian_weight.into(),
            news_weight: self.news_weight.into(),
            risk_tolerance_bps: self.risk_tolerance_bps.into(),
            conviction_threshold_bps: self.conviction_threshold_bps.into(),
            last_step_tick: OptionalTick {
                value: self.last_step_tick_value,
                present: self.flags & 4 != 0,
            },
            cooldown_started_tick: OptionalTick {
                value: self.cooldown_started_tick_value,
                present: self.flags & 8 != 0,
            },
            lifetime_pnl_cents: self.lifetime_pnl_cents.into(),
            wipeout_count: self.wipeout_count.into(),
            filled_order_count: self.filled_order_count.into(),
        })
    }
}

pub(crate) struct ActorEntry {
    actor: ActorState,
    compact: bool,
}

impl Deref for ActorEntry {
    type Target = ActorState;
    fn deref(&self) -> &Self::Target {
        &self.actor
    }
}
impl DerefMut for ActorEntry {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.actor
    }
}

pub(crate) fn load_bucket(ctx: &ReducerContext, bucket: u8) -> Result<Vec<ActorEntry>> {
    let mut actors = Vec::new();
    // Counts are O(1); avoid an empty index scan without per-actor lookups.
    if ctx.db.actor_state_compact().count() != 0 {
        for a in ctx.db.actor_state_compact().bucket().filter(bucket) {
            actors.push(ActorEntry {
                actor: a.unpack()?,
                compact: true,
            });
        }
    }
    if ctx.db.actor_state().count() != 0 {
        actors.extend(
            ctx.db
                .actor_state()
                .bucket()
                .filter(bucket)
                .map(|actor| ActorEntry {
                    actor,
                    compact: false,
                }),
        );
    }
    actors.sort_unstable_by_key(|a| a.actor_id);
    if actors
        .windows(2)
        .any(|pair| pair[0].actor_id == pair[1].actor_id)
    {
        return Err("duplicate actor storage".into());
    }
    Ok(actors)
}

/// Initialization owns a fresh contiguous ID range, so no source lookup needed.
pub(crate) fn insert(ctx: &ReducerContext, actor: ActorState) {
    if let Some(row) = ActorStateCompact::pack(&actor) {
        ctx.db.actor_state_compact().insert(row);
    } else {
        ctx.db.actor_state().insert(actor);
    }
}

pub(crate) fn update(ctx: &ReducerContext, entry: ActorEntry) {
    if entry.compact {
        if let Some(row) = ActorStateCompact::pack(&entry.actor) {
            ctx.db.actor_state_compact().actor_id().update(row);
        } else {
            // Promotion shares the tick transaction, including settlement and
            // receipts. Never clamp a value or leave duplicate authoritative rows.
            ctx.db
                .actor_state_compact()
                .actor_id()
                .delete(entry.actor_id);
            ctx.db.actor_state().insert(entry.actor);
        }
    } else {
        ctx.db.actor_state().actor_id().update(entry.actor);
    }
}

pub(crate) fn find(ctx: &ReducerContext, actor_id: u64) -> Result<ActorEntry> {
    match (
        ctx.db.actor_state().actor_id().find(actor_id),
        ctx.db.actor_state_compact().actor_id().find(actor_id),
    ) {
        (Some(actor), None) => Ok(ActorEntry {
            actor,
            compact: false,
        }),
        (None, Some(row)) => Ok(ActorEntry {
            actor: row.unpack()?,
            compact: true,
        }),
        (None, None) => Err("actor missing".into()),
        _ => Err("duplicate actor storage".into()),
    }
}

/// Explicit reversible migration. Publication itself never rewrites actors.
#[reducer]
pub fn migrate_actor_storage_batch(
    ctx: &ReducerContext,
    start_actor_id: u64,
    count: u64,
    compact: bool,
) -> Result<()> {
    admin(ctx)?;
    let r = runtime(ctx)?;
    if r.phase != "READY"
        || r.enabled
        || ctx.db.tick_schedule().count() != 0
        || ctx.db.timed_run_stop().count() != 0
    {
        return Err("actor storage migration requires paused READY world without schedules".into());
    }
    if start_actor_id == 0 || count == 0 || count > config().setup_batch_max {
        return Err("invalid actor storage migration batch".into());
    }
    let end = start_actor_id
        .checked_add(count - 1)
        .ok_or("migration range overflow")?;
    if end > r.initialized {
        return Err("migration outside initialized actors".into());
    }
    for id in start_actor_id..=end {
        let entry = find(ctx, id)?;
        if compact && !entry.compact {
            if let Some(row) = ActorStateCompact::pack(&entry.actor) {
                ctx.db.actor_state().actor_id().delete(id);
                ctx.db.actor_state_compact().insert(row);
            }
        } else if !compact && entry.compact {
            ctx.db.actor_state_compact().actor_id().delete(id);
            ctx.db.actor_state().insert(entry.actor);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
