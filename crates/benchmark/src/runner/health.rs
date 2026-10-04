//! Market behavior is reported separately from schedule-adherence validation.
use crate::{bindings::*, client::Client};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Sample {
    /// Completed-tick count from MarketState (PricePoint uses count minus one).
    logical_tick: u64,
    price_cents: u64,
    active_actors: u64,
    matched_shares: u64,
    chaos_active: bool,
}

impl From<&MarketState> for Sample {
    fn from(m: &MarketState) -> Self {
        Self {
            logical_tick: m.logical_tick,
            price_cents: m.price_cents,
            active_actors: m.active_actor_count,
            matched_shares: m.matched_share_volume,
            chaos_active: m.chaos_active,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Health {
    pub samples: Vec<Sample>,
    pub min_price_cents: Option<u64>,
    pub max_price_cents: Option<u64>,
    pub final_price_cents: Option<u64>,
    pub floor_ticks: usize,
    pub longest_floor_streak_ticks: usize,
    pub zero_volume_ticks: usize,
    pub contiguous_from_first_tick: bool,
    pub active_actors: u64,
    pub exiting_actors: u64,
    pub cooldown_actors: u64,
    pub actors_wiped_at_least_once: u64,
    pub exiting_shares: String,
    pub recapitalizations: u64,
    pub recapitalization_cash_cents: String,
}

fn history(samples: Vec<Sample>, floor: u64) -> Health {
    let mut streak = 0;
    let mut longest = 0;
    let mut previous_tick = 0;
    for sample in &samples {
        if sample.logical_tick != previous_tick + 1 {
            streak = 0;
        }
        streak = if sample.price_cents == floor {
            streak + 1
        } else {
            0
        };
        longest = longest.max(streak);
        previous_tick = sample.logical_tick;
    }
    Health {
        min_price_cents: samples.iter().map(|s| s.price_cents).min(),
        max_price_cents: samples.iter().map(|s| s.price_cents).max(),
        final_price_cents: samples.last().map(|s| s.price_cents),
        floor_ticks: samples.iter().filter(|s| s.price_cents == floor).count(),
        longest_floor_streak_ticks: longest,
        zero_volume_ticks: samples.iter().filter(|s| s.matched_shares == 0).count(),
        contiguous_from_first_tick: !samples.is_empty()
            && samples
                .iter()
                .enumerate()
                .all(|(i, s)| s.logical_tick == i as u64 + 1),
        samples,
        active_actors: 0,
        exiting_actors: 0,
        cooldown_actors: 0,
        actors_wiped_at_least_once: 0,
        exiting_shares: "0".into(),
        recapitalizations: 0,
        recapitalization_cash_cents: "0".into(),
    }
}

pub fn summarize(samples: Vec<Sample>, audit: &Client) -> crate::client::Result<Health> {
    let mut h = history(samples, one_market_core::config::config().min_price_cents);
    let mut exiting_shares = 0u128;
    for a in crate::client::audit_actors(audit)? {
        match a.status {
            ActorStatus::Active => h.active_actors += 1,
            ActorStatus::Exiting => {
                h.exiting_actors += 1;
                exiting_shares += u128::from(a.shares);
            }
            ActorStatus::Cooldown => h.cooldown_actors += 1,
        }
        if a.wipeout_count > 0 {
            h.actors_wiped_at_least_once += 1;
        }
    }
    h.exiting_shares = exiting_shares.to_string();
    if let Some(g) = audit.db.db.grant_accounting().id().find(&0) {
        h.recapitalizations = g.recapitalization_count;
        h.recapitalization_cash_cents = g.recapitalization_cash_cents.to_string();
    }
    Ok(h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(tick: u64, price: u64) -> Sample {
        Sample {
            logical_tick: tick,
            price_cents: price,
            active_actors: 200,
            matched_shares: if tick == 1 { 0 } else { 10 },
            chaos_active: false,
        }
    }

    #[test]
    fn reports_floor_duration_without_equating_trading_with_price_recovery() {
        let h = history(
            vec![sample(1, 10000), sample(2, 1), sample(3, 1), sample(4, 2)],
            1,
        );
        assert_eq!(h.min_price_cents, Some(1));
        assert_eq!(h.max_price_cents, Some(10000));
        assert_eq!(h.final_price_cents, Some(2));
        assert_eq!(h.floor_ticks, 2);
        assert_eq!(h.longest_floor_streak_ticks, 2);
        assert_eq!(h.zero_volume_ticks, 1);
        assert!(h.contiguous_from_first_tick);
    }

    #[test]
    fn missing_history_is_not_reported_as_continuous_evidence() {
        let h = history(vec![sample(1, 1), sample(3, 1)], 1);
        assert!(!h.contiguous_from_first_tick);
        assert_eq!(h.longest_floor_streak_ticks, 1);
        let empty = history(vec![], 1);
        assert!(!empty.contiguous_from_first_tick);
        assert_eq!(empty.final_price_cents, None);
    }
}
