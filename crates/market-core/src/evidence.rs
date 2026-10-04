use crate::{
    bucket,
    config::{config, Cadence},
    extend_digest,
    schedule::deadline,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Receipt {
    pub run_id: u64,
    pub intended_slot: u64,
    pub logical_tick: u64,
    pub intended_at_us: i64,
    pub invoked_at_us: i64,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Validation {
    pub status: String,
    pub reasons: Vec<String>,
    pub measured_actor_updates: u64,
    pub start_lateness_p99_us: u64,
    pub skipped_slots: u64,
    pub measured_filled_orders: u64,
    pub measured_matched_shares: u64,
}

pub fn validate(
    receipts: &[Receipt],
    run_id: u64,
    population: u64,
    origin_us: i64,
    run_failed: bool,
    load_valid: bool,
    healthy: bool,
) -> Validation {
    validate_at_cadence(
        receipts,
        run_id,
        population,
        origin_us,
        run_failed,
        load_valid,
        healthy,
        &config().default_cadence(),
    )
}

#[allow(clippy::too_many_arguments)]
pub fn validate_at_cadence(
    receipts: &[Receipt],
    run_id: u64,
    population: u64,
    origin_us: i64,
    run_failed: bool,
    load_valid: bool,
    healthy: bool,
    cadence: &Cadence,
) -> Validation {
    let c = config();
    let mut result = Validation {
        status: "PASSED".into(),
        reasons: vec![],
        measured_actor_updates: 0,
        start_lateness_p99_us: 0,
        skipped_slots: 0,
        measured_filled_orders: 0,
        measured_matched_shares: 0,
    };
    let mut failure = run_failed;
    let mut incomplete = !healthy;
    if run_failed {
        result
            .reasons
            .push("runtime run is irreversibly FAILED".into());
    }
    if !load_valid {
        failure = true;
        result
            .reasons
            .push("fixed offered/viewer workload not maintained".into());
    }
    if !healthy {
        result
            .reasons
            .push("client disconnect or incomplete evidence".into());
    }
    let warmup_ticks = cadence
        .ticks_for_seconds(c.warmup_seconds)
        .expect("validated cadence");
    let expected_total = cadence
        .ticks_for_seconds(c.warmup_seconds + c.measurement_seconds)
        .expect("validated cadence");
    if receipts.len() as u64 != expected_total {
        incomplete = true;
        result
            .reasons
            .push("missing or excess tick receipts".into());
    }
    let mut digests = vec![vec![0; 32]; usize::from(c.buckets)];
    let mut counts = vec![0u64; usize::from(c.buckets)];
    for id in 1..=population {
        let b = bucket(id) as usize;
        counts[b] += 1;
        digests[b] = extend_digest(&digests[b], id);
    }
    let mut sorted = receipts.to_vec();
    sorted.sort_unstable_by_key(|r| r.logical_tick);
    let mut lateness = vec![];
    let mut sequences_ok = true;
    let mut coverage_ok = true;
    let mut deadlines_ok = true;
    for (i, r) in sorted.iter().enumerate() {
        // Absent evidence is inconclusive. A duplicate, wrong run, or a committed
        // slot/logical mismatch establishes a failure independently of delivery.
        if r.logical_tick != i as u64 {
            incomplete = true;
        }
        sequences_ok &= r.run_id == run_id
            && Some(r.intended_slot) == r.logical_tick.checked_add(1)
            && r.logical_tick < expected_total
            && (i == 0 || sorted[i - 1].logical_tick != r.logical_tick);
        let b = (r.logical_tick % u64::from(c.buckets)) as usize;
        coverage_ok &= r.bucket as usize == b
            && r.actor_steps == counts[b]
            && r.actor_rows_updated == counts[b]
            && r.membership_digest == digests[b]
            && r.previous_steps_valid
            && r.policy_evaluations <= r.actor_steps;
        deadlines_ok &= deadline(origin_us, r.intended_slot, cadence.tick_interval_us).ok()
            == Some(r.intended_at_us)
            && i128::from(r.invoked_at_us) - i128::from(r.intended_at_us)
                == i128::from(r.start_lateness_us)
            && r.schedule_debt_us == r.start_lateness_us;
        result.skipped_slots = result.skipped_slots.saturating_add(r.skipped_slots);
        if r.logical_tick >= warmup_ticks && r.logical_tick < expected_total {
            lateness.push(r.start_lateness_us);
            result.measured_actor_updates = result
                .measured_actor_updates
                .saturating_add(r.actor_rows_updated);
            result.measured_filled_orders = result
                .measured_filled_orders
                .saturating_add(r.orders_filled);
            result.measured_matched_shares = result
                .measured_matched_shares
                .saturating_add(r.matched_share_volume);
        }
    }
    for (ok, reason) in [
        (
            sequences_ok,
            "duplicate or invalid committed logical/slot sequence",
        ),
        (
            coverage_ok,
            "missing or duplicate actor updates / membership mismatch",
        ),
        (deadlines_ok, "deadline or debt evidence mismatch"),
        (result.skipped_slots == 0, "skipped application slots"),
    ] {
        if !ok {
            failure = true;
            result.reasons.push(reason.into());
        }
    }
    if !lateness.is_empty() {
        lateness.sort_unstable();
        result.start_lateness_p99_us = lateness[(lateness.len() * 99).div_ceil(100) - 1];
        if result.start_lateness_p99_us >= cadence.tick_interval_us {
            failure = true;
            result
                .reasons
                .push("P99 start lateness is not below the selected tick interval".into());
        }
        // Compare one target second at each end, using the selected slot budget.
        let measured: Vec<_> = sorted
            .iter()
            .filter(|r| r.logical_tick >= warmup_ticks && r.logical_tick < expected_total)
            .collect();
        let debt_window = cadence.ticks_for_seconds(1).expect("validated cadence") as usize;
        if measured.len() >= 2 * debt_window {
            let first: u128 = measured[..debt_window]
                .iter()
                .map(|r| u128::from(r.schedule_debt_us))
                .sum();
            let last: u128 = measured[measured.len() - debt_window..]
                .iter()
                .map(|r| u128::from(r.schedule_debt_us))
                .sum();
            if last >= first + debt_window as u128 * u128::from(cadence.tick_interval_us) {
                failure = true;
                result.reasons.push("growing schedule debt".into());
            }
        }
    } else {
        incomplete = true;
    }
    let expected_updates: u64 = (warmup_ticks..expected_total)
        .map(|tick| counts[(tick % u64::from(c.buckets)) as usize])
        .sum();
    if result.measured_actor_updates != expected_updates {
        incomplete = true;
        result
            .reasons
            .push("incomplete measured actor-update workload".into());
    }
    result.status = if failure {
        "FAILED"
    } else if incomplete {
        "INCONCLUSIVE"
    } else {
        "PASSED"
    }
    .into();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn evidence() -> Vec<Receipt> {
        let mut digest = vec![vec![0; 32]; 20];
        let mut counts = [0; 20];
        for id in 1..=20 {
            let b = bucket(id) as usize;
            digest[b] = extend_digest(&digest[b], id);
            counts[b] += 1;
        }
        (0..4200)
            .map(|tick| {
                let b = (tick % 20) as usize;
                Receipt {
                    run_id: 1,
                    intended_slot: tick + 1,
                    logical_tick: tick,
                    intended_at_us: ((tick + 1) * 50_000) as i64,
                    invoked_at_us: ((tick + 1) * 50_000 + 100) as i64,
                    start_lateness_us: 100,
                    skipped_slots: 0,
                    schedule_debt_us: 100,
                    bucket: b as u8,
                    actor_steps: counts[b],
                    policy_evaluations: counts[b],
                    actor_rows_updated: counts[b],
                    membership_digest: digest[b].clone(),
                    previous_steps_valid: true,
                    orders_submitted: 0,
                    orders_filled: 0,
                    matched_share_volume: 0,
                }
            })
            .collect()
    }
    #[test]
    fn ten_hz_uses_its_own_budget_and_half_as_many_actor_updates() {
        let cadence = config().cadence("10hz").unwrap();
        let mut rows = evidence();
        rows.truncate(cadence.ticks_for_seconds(210).unwrap() as usize);
        for r in &mut rows {
            r.intended_at_us = deadline(0, r.intended_slot, cadence.tick_interval_us).unwrap();
            r.invoked_at_us = r.intended_at_us + 60_000;
            r.start_lateness_us = 60_000;
            r.schedule_debt_us = 60_000;
        }
        let validate =
            |rows: &[Receipt]| validate_at_cadence(rows, 1, 20, 0, false, true, true, &cadence);
        let good = validate(&rows);
        assert_eq!(good.status, "PASSED", "{:?}", good.reasons);
        assert_eq!(good.measured_actor_updates, 20 * 90);
        assert_eq!(good.start_lateness_p99_us, 60_000);
        assert_eq!(
            super::validate(&rows, 1, 20, 0, false, true, true).status,
            "FAILED"
        );
        rows[400].actor_rows_updated -= 1;
        assert_eq!(validate(&rows).status, "FAILED");
    }

    #[test]
    fn missing_duplicate_and_reduced_workload_never_qualify() {
        let good = evidence();
        assert_eq!(
            validate(&good, 1, 20, 0, false, true, true).status,
            "PASSED"
        );
        let mut missing = good.clone();
        missing.remove(650);
        assert_eq!(
            validate(&missing, 1, 20, 0, false, true, true).status,
            "INCONCLUSIVE"
        );
        let mut duplicate = good.clone();
        duplicate[651] = duplicate[650].clone();
        assert_eq!(
            validate(&duplicate, 1, 20, 0, false, true, true).status,
            "FAILED"
        );
        let mut reduced = good.clone();
        reduced[660].actor_rows_updated = 999;
        assert_eq!(
            validate(&reduced, 1, 20, 0, false, true, true).status,
            "FAILED"
        );
        let mut membership = good.clone();
        membership[660].membership_digest[0] ^= 1;
        assert_eq!(
            validate(&membership, 1, 20, 0, false, true, true).status,
            "FAILED"
        );
        assert_eq!(validate(&good, 1, 20, 0, true, true, true).status, "FAILED");
        assert_eq!(
            validate(&good, 1, 20, 0, false, true, false).status,
            "INCONCLUSIVE"
        );
        assert_eq!(
            validate(&good, 1, 20, 0, false, false, true).status,
            "FAILED"
        );
    }
}
