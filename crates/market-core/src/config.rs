use serde::{Deserialize, Serialize};

pub const CONFIG_JSON: &str = include_str!("../../../config/v02.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub version: String,
    pub default_cadence: String,
    pub cadence_profiles: Vec<Cadence>,
    pub buckets: u8,
    pub min_price_cents: u64,
    pub max_price_cents: u64,
    pub initial_price_cents: u64,
    pub actor_cash_cents: u64,
    pub actor_shares: u64,
    pub bankroll_cents: u64,
    pub seed: u64,
    pub setup_batch_max: u64,
    pub population_max: u64,
    pub human_max_quantity: u64,
    pub human_interval_us: u64,
    pub pending_order_max: u64,
    pub slippage_bps: u64,
    pub actor_max_quantity: u64,
    pub quote_reversion_bps: u64,
    pub signal_reversion_bps: u64,
    pub valuation_spread_bps: u64,
    pub valuation_horizon_ticks: u64,
    pub sentiment_max_bps: u64,
    pub sentiment_interval_ticks: u64,
    pub sentiment_smoothing_epochs: u64,
    pub reference_step_divisor: u64,
    pub shared_news_weight_bps: u64,
    pub liquidation_max_quantity: u64,
    pub liquidation_discount_bps: u64,
    pub drawdown_bps: u64,
    pub cooldown_ticks: u64,
    pub revival_enabled: bool,
    pub revival_floor_cents: u64,
    pub revival_distress_ticks: u64,
    pub revival_low_active_bps: u64,
    pub revival_healthy_active_bps: u64,
    pub revival_healthy_ticks: u64,
    pub revival_exit_wait_ticks: u64,
    pub revival_cohort_epochs: u64,
    pub revival_window_ticks: u64,
    pub revival_backoff_ticks: u64,
    pub revival_actor_cap_cents: u64,
    pub revival_episode_budget_bps: u64,
    pub revival_total_budget_bps: u64,
    pub price_retention: u64,
    pub activity_retention: u64,
    pub activity_interval_us: u64,
    pub news_retention: u64,
    pub sample_size: u64,
    pub human_receipt_retention: u64,
    pub tick_receipt_retention: u64,
    pub detailed_run_retention: u64,
    pub result_retention: u64,
    pub rate_window_us: u64,
    pub warmup_seconds: u64,
    pub measurement_seconds: u64,
    pub confirmation_runs: u64,
    pub viewers: u64,
    pub offered_orders_per_second: u64,
    pub chaos_slot: u64,
    pub chaos_duration_ticks: u64,
    pub chaos_severity_bps: u64,
    pub chaos_confidence_bps: u64,
    pub generator: String,
    pub policy: String,
    pub tick_phases: String,
    pub recovery: String,
    pub order_ids: String,
    pub human_script: String,
    pub observer_queries: Vec<String>,
}

/// The versioned registry is the only source of scheduler intervals.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cadence {
    pub id: String,
    pub tick_interval_us: u64,
}

impl Cadence {
    pub fn ticks_for_seconds(&self, seconds: u64) -> crate::Result<u64> {
        if self.tick_interval_us == 0 || 1_000_000 % self.tick_interval_us != 0 {
            return Err("cadence must divide a wall-clock second exactly".into());
        }
        seconds
            .checked_mul(1_000_000 / self.tick_interval_us)
            .ok_or_else(|| "tick count overflow".into())
    }
}

impl Config {
    pub fn cadence(&self, id: &str) -> crate::Result<Cadence> {
        let selected = self
            .cadence_profiles
            .iter()
            .find(|c| c.id == id)
            .ok_or("unknown cadence profile")?
            .clone();
        selected.ticks_for_seconds(1)?;
        Ok(selected)
    }

    pub fn default_cadence(&self) -> Cadence {
        self.cadence(&self.default_cadence)
            .expect("compiled default cadence must be valid")
    }
}

pub fn config() -> Config {
    serde_json::from_str(CONFIG_JSON).expect("compiled versioned configuration must be valid")
}

pub fn configuration_hash() -> String {
    blake3::hash(CONFIG_JSON.as_bytes()).to_hex().to_string()
}

/// Includes the selected population, seed and profile, not just static defaults.
pub fn workload_hash(population: u64, seed: u64, profile: &str) -> String {
    workload_hash_at_cadence(population, seed, profile, &config().default_cadence())
}

pub fn workload_hash_at_cadence(
    population: u64,
    seed: u64,
    profile: &str,
    cadence: &Cadence,
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"one-market-workload-v2\0");
    hasher.update(CONFIG_JSON.as_bytes());
    hasher.update(&population.to_le_bytes());
    hasher.update(&seed.to_le_bytes());
    hasher.update(profile.as_bytes());
    hasher.update(b"\0cadence\0");
    hasher.update(cadence.id.as_bytes());
    hasher.update(&cadence.tick_interval_us.to_le_bytes());
    hasher.finalize().to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cadence_registry_and_hashes_are_explicit() {
        let c = config();
        assert_eq!(c.default_cadence().id, "20hz");
        assert_eq!(c.buckets, 20);
        let mut hashes = std::collections::HashSet::new();
        // 5 Hz is prepared and arithmetic-tested, not used to run a simulation.
        for (id, hz, epoch_us) in [
            ("20hz", 20, 1_000_000),
            ("10hz", 10, 2_000_000),
            ("5hz", 5, 4_000_000),
        ] {
            let cadence = c.cadence(id).unwrap();
            assert_eq!(cadence.ticks_for_seconds(1).unwrap(), hz);
            assert_eq!(cadence.tick_interval_us * u64::from(c.buckets), epoch_us);
            assert!(cadence.ticks_for_seconds(u64::MAX).is_err());
            assert!(hashes.insert(workload_hash_at_cadence(
                375_000, c.seed, "NORMAL", &cadence
            )));
        }
        assert!(c.cadence("11hz").is_err());
    }

    #[test]
    fn frozen_revival_defaults_have_time_for_a_full_eligible_cohort_cycle() {
        let c = config();
        assert_eq!(c.buckets, 20);
        assert!(c.revival_cohort_epochs > 0);
        assert!(
            c.revival_window_ticks
                >= c.revival_exit_wait_ticks + c.revival_cohort_epochs * u64::from(c.buckets)
        );
        assert!(c.revival_low_active_bps < c.revival_healthy_active_bps);
        assert!(c.revival_healthy_active_bps <= 10_000);
        assert!(c.revival_floor_cents >= c.min_price_cents);
        assert!(c.revival_episode_budget_bps <= c.revival_total_budget_bps);
        assert!(c.revival_actor_cap_cents <= c.bankroll_cents);
    }

    #[test]
    fn recovery_workload_cannot_reuse_old_or_different_run_qualification() {
        let normal = workload_hash(375_000, 20261003, "NORMAL");
        assert_ne!(
            normal,
            "f63de483e5aa7a3a6d6bdfd812fb6c17bed72956956c5d61c8ba34978b5f9340"
        );
        assert_ne!(normal, workload_hash(325_000, 20261003, "NORMAL"));
        assert_ne!(normal, workload_hash(375_000, 42, "NORMAL"));
        assert_ne!(normal, workload_hash(375_000, 20261003, "CHAOS"));
        assert_eq!(normal, workload_hash(375_000, 20261003, "NORMAL"));
    }
}
