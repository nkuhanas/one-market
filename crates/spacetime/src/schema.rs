use spacetimedb::{table, ConnectionId, Identity, ScheduleAt, Timestamp};

#[table(accessor = market_state, public)]
#[derive(Clone)]
pub struct MarketState {
    #[primary_key]
    pub id: u8,
    // Deprecated observer aliases; written with the canonical fields.
    pub tick: u64,
    pub price: u64,
    pub logical_tick: u64,
    pub epoch: u64,
    pub price_cents: u64,
    pub previous_traded_price_cents: u64,
    pub matched_share_volume: u64,
    pub volatility_bps: u64,
    pub actor_count: u64,
    pub active_actor_count: u64,
    pub registered_human_trader_count: u64,
    pub connected_identity_count: u64,
    pub cumulative_actor_steps: u64,
    pub cumulative_policy_evaluations: u64,
    pub cumulative_actor_rows_updated: u64,
    pub cumulative_orders_submitted: u64,
    pub cumulative_orders_filled: u64,
    pub cumulative_matched_share_volume: u64,
    pub rate_window_us: u64,
    pub rate_window_started_at: Timestamp,
    pub rate_window_ended_at: Timestamp,
    pub chaos_active: bool,
    pub phase: String,
    pub configuration_hash: String,
}

#[table(accessor = runtime_config)]
#[derive(Clone)]
pub struct RuntimeConfig {
    #[primary_key]
    pub id: u8,
    pub phase: String,
    pub target_population: u64,
    pub initialized: u64,
    pub seed: u64,
    pub generation: u64,
    pub enabled: bool,
    pub origin: Timestamp,
    pub next_slot: u64,
    pub run_id: u64,
    pub next_run_id: u64,
    pub next_order_key: u64,
    pub next_activity_id: u64,
    pub next_news_id: u64,
    pub last_activity_at: Timestamp,
    pub imbalance_bps: i64,
    pub chaos_start: u64,
    pub chaos_end: u64,
    pub chaos_signal_bps: i64,
}

#[table(accessor = admin_allowlist)]
pub struct AdminAllowlist {
    #[primary_key]
    pub identity: Identity,
}

#[table(accessor = benchmark_reader)]
pub struct BenchmarkReader {
    #[primary_key]
    pub identity: Identity,
}

#[table(accessor = tick_schedule, scheduled(crate::simulation_tick))]
#[derive(Clone)]
pub struct TickSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
    pub generation: u64,
    pub intended_slot: u64,
}

#[table(accessor = actor_state)]
#[derive(Clone)]
pub struct ActorState {
    #[primary_key]
    pub actor_id: u64,
    #[index(btree)]
    pub bucket: u8,
    pub cash_cents: u64,
    pub shares: u64,
    pub marked_equity_cents: u64,
    pub initial_endowment_value_cents: u64,
    pub life_peak_equity_cents: u64,
    pub cumulative_recapitalization_grants_cents: u64,
    pub momentum_weight: i32,
    pub mean_reversion_weight: i32,
    pub contrarian_weight: i32,
    pub news_weight: i32,
    pub risk_tolerance_bps: u64,
    pub conviction_threshold_bps: u64,
    pub last_step_tick: Option<u64>,
    pub status: String,
    pub cooldown_started_tick: Option<u64>,
    pub lifetime_pnl_cents: i64,
    pub wipeout_count: u64,
    pub filled_order_count: u64,
}

#[table(accessor = bucket_manifest)]
pub struct BucketManifest {
    #[primary_key]
    pub bucket: u8,
    pub actor_count: u64,
    pub membership_digest: Vec<u8>,
}

#[table(accessor = human_trader)]
#[derive(Clone)]
pub struct HumanTrader {
    #[primary_key]
    pub identity: Identity,
    pub cash_cents: u64,
    pub shares: u64,
    pub reserved_cash_cents: u64,
    pub reserved_shares: u64,
    pub pnl_cents: i64,
    pub created_at: Timestamp,
    pub last_order_at: Option<Timestamp>,
    pub completed_orders: u64,
}

#[table(accessor = order_watermark)]
pub struct OrderWatermark {
    #[primary_key]
    pub identity: Identity,
    pub client_order_id: u64,
}

#[table(accessor = pending_human_order)]
#[derive(Clone)]
pub struct PendingHumanOrder {
    #[primary_key]
    pub identity: Identity,
    pub order_key: u64,
    pub client_order_id: u64,
    pub buy: bool,
    pub quantity: u64,
    pub limit_price_cents: u64,
    pub accepted_at: Timestamp,
}

#[table(accessor = human_order_receipt)]
#[derive(Clone)]
pub struct HumanOrderReceipt {
    #[primary_key]
    pub key: String,
    #[index(btree)]
    pub identity: Identity,
    pub client_order_id: u64,
    pub sequence: u64,
    pub logical_tick: u64,
    pub buy: bool,
    pub requested_quantity: u64,
    pub filled_quantity: u64,
    pub price_cents: u64,
    pub status: String,
    pub recorded_at: Timestamp,
}

#[table(accessor = connection_state)]
pub struct ConnectionState {
    #[primary_key]
    pub connection_id: ConnectionId,
    #[index(btree)]
    pub identity: Identity,
}

#[table(accessor = grant_accounting)]
pub struct GrantAccounting {
    #[primary_key]
    pub id: u8,
    pub actor_initial_cash_cents: u128,
    pub human_entry_cash_cents: u128,
    pub recapitalization_cash_cents: u128,
    pub initial_share_supply: u128,
    pub human_entry_count: u64,
    pub recapitalization_count: u64,
}

#[table(accessor = price_point, public)]
pub struct PricePoint {
    #[primary_key]
    pub logical_tick: u64,
    pub recorded_at: Timestamp,
    pub price_cents: u64,
    pub matched_share_volume: u64,
}

#[table(accessor = public_activity, public)]
pub struct PublicActivity {
    #[primary_key]
    pub id: u64,
    pub logical_tick: u64,
    pub recorded_at: Timestamp,
    pub participant_type: String,
    pub participant_id: String,
    pub event_kind: String,
    pub side: String,
    pub quantity: u64,
    pub price_cents: u64,
    pub lifetime_pnl_cents: i64,
    pub wipeout_count: u64,
}

#[table(accessor = news_event, public)]
pub struct NewsEvent {
    #[primary_key]
    pub id: u64,
    pub headline: String,
    pub direction: i8,
    pub severity_bps: u64,
    pub confidence_bps: u64,
    pub start_tick: u64,
    pub end_tick: u64,
}

#[table(accessor = actor_sample, public)]
pub struct ActorSample {
    #[primary_key]
    pub actor_id: u64,
    pub status: String,
    pub marked_equity_cents: u64,
    pub lifetime_pnl_cents: i64,
    pub wipeout_count: u64,
    pub last_step_tick: Option<u64>,
}

#[table(accessor = run_record)]
#[derive(Clone)]
pub struct RunRecord {
    #[primary_key]
    pub run_id: u64,
    pub status: String,
    pub failure_reason: String,
    pub profile: String,
    pub qualification: bool,
    pub origin: Timestamp,
    pub population: u64,
    pub seed: u64,
    pub configuration_hash: String,
    pub build_hash: String,
    pub skipped_slots: u64,
    pub committed_ticks: u64,
    pub last_slot: u64,
    pub last_receipt_at: Timestamp,
    pub max_lateness_us: u64,
    pub completed_at: Option<Timestamp>,
}

#[table(accessor = detailed_benchmark_receipts)]
#[derive(Clone)]
pub struct TickReceipt {
    #[primary_key]
    pub key: String,
    #[index(btree)]
    pub run_id: u64,
    pub intended_slot: u64,
    pub logical_tick: u64,
    pub intended_at: Timestamp,
    pub invoked_at: Timestamp,
    pub start_lateness_us: u64,
    pub skipped_slots: u64,
    pub schedule_debt_us: u64,
    pub bucket: u8,
    pub actor_steps: u64,
    pub policy_evaluations: u64,
    pub actor_rows_updated: u64,
    pub membership_digest: Vec<u8>,
    pub previous_steps_valid: bool,
    pub orders_submitted: u64,
    pub orders_filled: u64,
    pub matched_share_volume: u64,
}

#[table(accessor = benchmark_result, public)]
pub struct BenchmarkResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub status: String,
    pub environment: String,
    pub workload_profile: String,
    pub actor_count: u64,
    pub tick_interval_us: u64,
    pub bucket_count: u8,
    pub warmup_seconds: u64,
    pub measurement_seconds: u64,
    pub repeat_count: u64,
    pub subscriber_count: u64,
    pub offered_human_orders_per_second: u64,
    pub committed_actor_updates: u64,
    pub skipped_application_slots: u64,
    pub start_lateness_p99_us: u64,
    pub configuration_hash: String,
    pub build_hash: String,
    pub evidence_hash: String,
    pub run_ids: Vec<u64>,
    pub completed_at: Option<Timestamp>,
}

#[table(accessor = validated_run)]
pub struct ValidatedRun {
    #[primary_key]
    pub run_id: u64,
    pub evidence_hash: String,
    pub measured_actor_updates: u64,
    pub start_lateness_p99_us: u64,
}
