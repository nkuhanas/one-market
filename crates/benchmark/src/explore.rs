//! Short, explicitly non-qualifying probes. Production qualification stays in
//! market-core::evidence::validate with its unchanged fixed 30s + 180s gate.
use one_market_core::{
    bucket,
    config::{config, Cadence},
    evidence::{Receipt, Validation},
    extend_digest,
    schedule::deadline,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy)]
pub struct Window {
    pub warmup_seconds: u64,
    pub measurement_seconds: u64,
    pub repeats: u64,
}
impl Window {
    pub fn new(
        warmup_seconds: u64,
        measurement_seconds: u64,
        repeats: u64,
    ) -> Result<Self, String> {
        if warmup_seconds == 0
            || measurement_seconds < 5
            || warmup_seconds
                .checked_add(measurement_seconds)
                .is_none_or(|s| s > 800)
            || !(1..=3).contains(&repeats)
        {
            return Err(
                "exploration requires 1+s warmup, 5+s measurement, <=800s total and retained slot evidence, 1..3 repeats"
                    .into(),
            );
        }
        Ok(Self {
            warmup_seconds,
            measurement_seconds,
            repeats,
        })
    }
}

#[derive(Serialize, Deserialize)]
pub struct Metrics {
    pub cadence_profile: String,
    pub tick_interval_us: u64,
    pub bucket_count: u8,
    pub validation: Validation,
    pub actor_updates_per_second: f64,
    pub submitted_orders_per_second: f64,
    pub filled_orders_per_second: f64,
    pub matched_shares_per_second: f64,
    pub max_lateness_us: u64,
    pub measured_wall_time_us: u64,
    pub observed_slots: u64,
    pub expected_slots: u64,
}

#[allow(clippy::too_many_arguments)]
pub fn measure(
    receipts: &[Receipt],
    run_id: u64,
    population: u64,
    origin: i64,
    window: Window,
    runtime_failed: bool,
    load_valid: bool,
    healthy: bool,
    cadence: &Cadence,
) -> Metrics {
    let c = config();
    let warmup_ticks = cadence
        .ticks_for_seconds(window.warmup_seconds)
        .expect("validated cadence");
    let end_slot = cadence
        .ticks_for_seconds(window.warmup_seconds + window.measurement_seconds)
        .expect("validated cadence");
    let mut rows: Vec<_> = receipts
        .iter()
        .filter(|r| r.intended_slot <= end_slot)
        .collect();
    rows.sort_unstable_by_key(|r| r.logical_tick);
    let mut counts = vec![0u64; usize::from(c.buckets)];
    let mut digests = vec![vec![0; 32]; usize::from(c.buckets)];
    for id in 1..=population {
        let b = bucket(id) as usize;
        counts[b] += 1;
        digests[b] = extend_digest(&digests[b], id);
    }
    let mut reasons = vec![];
    if runtime_failed {
        reasons.push("runtime failure or conservation failure before intentional stop".into());
    }
    if !load_valid {
        reasons.push("fixed offered/viewer workload not maintained".into());
    }
    if !healthy {
        reasons.push("client disconnect or stalled evidence".into());
    }
    if rows.len() as u64 != end_slot {
        reasons.push("incomplete intended-slot evidence".into());
    }
    let valid = rows.iter().enumerate().all(|(i, r)| {
        let b = (r.logical_tick % u64::from(c.buckets)) as usize;
        r.run_id == run_id
            && r.logical_tick == i as u64
            && Some(r.intended_slot) == r.logical_tick.checked_add(1)
            && r.bucket as usize == b
            && r.actor_steps == counts[b]
            && r.actor_rows_updated == counts[b]
            && r.membership_digest == digests[b]
            && r.previous_steps_valid
            && r.policy_evaluations <= r.actor_steps
            && deadline(origin, r.intended_slot, cadence.tick_interval_us).ok()
                == Some(r.intended_at_us)
            && i128::from(r.invoked_at_us) - i128::from(r.intended_at_us)
                == i128::from(r.start_lateness_us)
            && r.schedule_debt_us == r.start_lateness_us
    });
    if !valid {
        reasons.push("slot sequence, deadline, or actor coverage mismatch".into());
    }
    let skipped: u64 = rows.iter().map(|r| r.skipped_slots).sum();
    if skipped > 0 {
        reasons.push("skipped application slots".into());
    }
    let mut lateness: Vec<_> = rows
        .iter()
        .filter(|r| r.intended_slot > warmup_ticks)
        .map(|r| r.start_lateness_us)
        .collect();
    lateness.sort_unstable();
    let p99 = if lateness.is_empty() {
        0
    } else {
        lateness[(lateness.len() * 99).div_ceil(100) - 1]
    };
    if p99 >= cadence.tick_interval_us {
        reasons.push("P99 start lateness is not below the selected tick interval".into());
    }
    let measured_slots: Vec<_> = rows
        .iter()
        .filter(|r| r.intended_slot > warmup_ticks)
        .collect();
    let debt_window = cadence.ticks_for_seconds(1).expect("validated cadence") as usize;
    if measured_slots.len() >= 2 * debt_window {
        let first: u128 = measured_slots[..debt_window]
            .iter()
            .map(|r| u128::from(r.schedule_debt_us))
            .sum();
        let last: u128 = measured_slots[measured_slots.len() - debt_window..]
            .iter()
            .map(|r| u128::from(r.schedule_debt_us))
            .sum();
        if last >= first + debt_window as u128 * u128::from(cadence.tick_interval_us) {
            reasons.push("growing schedule debt".into());
        }
    }
    // Actual invocation timestamps define throughput, including missed work.
    // Never divide updates by completed ticks and pretend target cadence held.
    let start_us = origin + (window.warmup_seconds * 1_000_000) as i64;
    let end_us = start_us + (window.measurement_seconds * 1_000_000) as i64;
    let measured: Vec<_> = receipts
        .iter()
        .filter(|r| r.invoked_at_us >= start_us && r.invoked_at_us < end_us)
        .collect();
    let updates = measured.iter().map(|r| r.actor_rows_updated).sum::<u64>();
    let submitted = measured.iter().map(|r| r.orders_submitted).sum::<u64>();
    let filled = measured.iter().map(|r| r.orders_filled).sum::<u64>();
    let shares = measured.iter().map(|r| r.matched_share_volume).sum::<u64>();
    Metrics {
        cadence_profile: cadence.id.clone(),
        tick_interval_us: cadence.tick_interval_us,
        bucket_count: c.buckets,
        validation: Validation {
            status: if reasons.is_empty() {
                "EXPLORE_PASS"
            } else {
                "EXPLORE_FAIL"
            }
            .into(),
            reasons,
            measured_actor_updates: updates,
            start_lateness_p99_us: p99,
            skipped_slots: skipped,
            measured_filled_orders: filled,
            measured_matched_shares: shares,
        },
        actor_updates_per_second: updates as f64 / window.measurement_seconds as f64,
        submitted_orders_per_second: submitted as f64 / window.measurement_seconds as f64,
        filled_orders_per_second: filled as f64 / window.measurement_seconds as f64,
        matched_shares_per_second: shares as f64 / window.measurement_seconds as f64,
        max_lateness_us: rows.iter().map(|r| r.start_lateness_us).max().unwrap_or(0),
        measured_wall_time_us: window.measurement_seconds * 1_000_000,
        observed_slots: rows.len() as u64,
        expected_slots: end_slot,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete_receipts(population: u64) -> Vec<Receipt> {
        let mut counts = [0u64; 20];
        let mut digests = vec![vec![0; 32]; 20];
        for id in 1..=population {
            let b = bucket(id) as usize;
            counts[b] += 1;
            digests[b] = extend_digest(&digests[b], id);
        }
        (0..120)
            .map(|tick| {
                let b = (tick % 20) as usize;
                let intended =
                    deadline(0, tick + 1, config().default_cadence().tick_interval_us).unwrap();
                Receipt {
                    run_id: 1,
                    intended_slot: tick + 1,
                    logical_tick: tick,
                    intended_at_us: intended,
                    invoked_at_us: intended + 1_000,
                    start_lateness_us: 1_000,
                    skipped_slots: 0,
                    schedule_debt_us: 1_000,
                    bucket: b as u8,
                    actor_steps: counts[b],
                    policy_evaluations: counts[b],
                    actor_rows_updated: counts[b],
                    membership_digest: digests[b].clone(),
                    previous_steps_valid: true,
                    orders_submitted: 2,
                    orders_filled: 2,
                    matched_share_volume: 1,
                }
            })
            .collect()
    }

    #[test]
    fn exploration_keeps_coverage_timing_and_load_gates_and_wall_time_rates() {
        let rows = complete_receipts(200);
        let window = Window::new(1, 5, 1).unwrap();
        let validate = |r: &[Receipt], failed, load, healthy| {
            measure(
                r,
                1,
                200,
                0,
                window,
                failed,
                load,
                healthy,
                &config().default_cadence(),
            )
        };
        let good = validate(&rows, false, true, true);
        assert_eq!(good.validation.status, "EXPLORE_PASS");
        assert_eq!(good.actor_updates_per_second, 200.0);
        assert_eq!(good.filled_orders_per_second, 40.0);
        for damage in 0..8 {
            let mut changed = rows.clone();
            match damage {
                0 => {
                    changed.remove(21);
                }
                1 => {
                    changed.push(changed[21].clone());
                }
                2 => {
                    changed[21].actor_rows_updated -= 1;
                }
                3 => {
                    changed[21].membership_digest[0] ^= 1;
                }
                4 => {
                    changed[21].previous_steps_valid = false;
                }
                5 => {
                    changed[21].skipped_slots = 1;
                }
                6 => {
                    changed[21].intended_at_us += 1;
                }
                _ => {
                    for row in &mut changed {
                        row.invoked_at_us += 50_000;
                        row.start_lateness_us += 50_000;
                        row.schedule_debt_us += 50_000;
                    }
                }
            }
            assert_eq!(
                validate(&changed, false, true, true).validation.status,
                "EXPLORE_FAIL"
            );
        }
        for (failed, load, healthy) in [
            (true, true, true),
            (false, false, true),
            (false, true, false),
        ] {
            assert_eq!(
                validate(&rows, failed, load, healthy).validation.status,
                "EXPLORE_FAIL"
            );
        }
        // Missing work must lower wall-time throughput, not shrink its denominator.
        let fewer = validate(&rows[..80], false, true, true);
        assert!(fewer.actor_updates_per_second < 200.0);
        assert_eq!(fewer.measured_wall_time_us, 5_000_000);
    }

    #[test]
    fn ten_hz_counts_wall_seconds_and_keeps_coverage_and_slot_gates() {
        let cadence = config().cadence("10hz").unwrap();
        let window = Window::new(2, 6, 1).unwrap();
        let mut rows = complete_receipts(200);
        rows.truncate(80);
        for r in &mut rows {
            r.intended_at_us = deadline(0, r.intended_slot, cadence.tick_interval_us).unwrap();
            r.invoked_at_us = r.intended_at_us + 60_000;
            r.start_lateness_us = 60_000;
            r.schedule_debt_us = 60_000;
        }
        let measure =
            |r: &[Receipt]| super::measure(r, 1, 200, 0, window, false, true, true, &cadence);
        let good = measure(&rows);
        assert_eq!(good.validation.status, "EXPLORE_PASS");
        assert_eq!(good.expected_slots, 80);
        assert_eq!(good.actor_updates_per_second, 100.0);
        assert_eq!(good.filled_orders_per_second, 20.0);
        rows[30].skipped_slots = 1;
        assert_eq!(measure(&rows).validation.status, "EXPLORE_FAIL");
    }

    #[test]
    fn rejects_unbounded_windows_and_never_qualifies_missing_evidence() {
        assert!(Window::new(0, 20, 1).is_err());
        assert!(Window::new(u64::MAX, 20, 1).is_err());
        assert!(Window::new(30, 780, 1).is_err());
        assert!(Window::new(5, 20, 4).is_err());
        let m = measure(
            &[],
            1,
            200,
            0,
            Window::new(5, 20, 1).unwrap(),
            false,
            true,
            true,
            &config().default_cadence(),
        );
        assert_eq!(m.validation.status, "EXPLORE_FAIL");
        assert_eq!(m.actor_updates_per_second, 0.0);
    }
}
