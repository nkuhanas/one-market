use serde::{Deserialize, Serialize};

pub const CONFIG_JSON: &str = include_str!("../../../config/v02.json");

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    pub version: String,
    pub tick_interval_us: u64,
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
    pub liquidation_max_quantity: u64,
    pub liquidation_discount_bps: u64,
    pub drawdown_bps: u64,
    pub cooldown_ticks: u64,
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

pub fn config() -> Config {
    serde_json::from_str(CONFIG_JSON).expect("compiled versioned configuration must be valid")
}

pub fn configuration_hash() -> String {
    blake3::hash(CONFIG_JSON.as_bytes()).to_hex().to_string()
}

/// Includes the selected population, seed and profile, not just static defaults.
pub fn workload_hash(population: u64, seed: u64, profile: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"one-market-workload-v1\0");
    hasher.update(CONFIG_JSON.as_bytes());
    hasher.update(&population.to_le_bytes());
    hasher.update(&seed.to_le_bytes());
    hasher.update(profile.as_bytes());
    hasher.finalize().to_hex().to_string()
}
