//! Read-only audit of a completed six-run archive, separate from live collection.
//! Run through scripts/audit-capacity after measurement has stopped.
use super::*;

fn readback(directory: &std::path::Path, table: &str) -> Vec<BTreeMap<String, serde_json::Value>> {
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(directory.join(format!("readback-{table}.json"))).unwrap(),
    )
    .unwrap();
    let result = &value.as_array().unwrap()[0];
    let names: Vec<_> = result["schema"]["elements"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"]["some"].as_str().unwrap().to_owned())
        .collect();
    result["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            let fields = r.as_array().unwrap();
            assert_eq!(names.len(), fields.len());
            names.iter().cloned().zip(fields.iter().cloned()).collect()
        })
        .collect()
}

#[test]
#[ignore = "requires CAPACITY_ARTIFACT_DIR and a completed six-run qualification archive"]
fn qualification_archive_matches_raw_evidence() {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap();
    let root = repo.join(std::env::var("CAPACITY_ARTIFACT_DIR").expect("artifact directory"));
    let wasm = std::env::var("CAPACITY_WASM").unwrap_or("artifacts/builds/fixed-row.wasm".into());
    let output = std::process::Command::new("sha256sum")
        .arg(repo.join(wasm))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let hash_output = String::from_utf8(output.stdout).unwrap();
    let build_hash = hash_output.split_whitespace().next().unwrap();
    let c = config();
    let mut population = None;
    let mut build_metadata = None;
    let mut reports = vec![];
    let mut summary_hashes = BTreeMap::new();
    for profile in ["NORMAL", "CHAOS"] {
        let directory = root.join(profile.to_lowercase());
        assert_eq!(
            fs::read(directory.join("workload.json")).unwrap(),
            CONFIG_JSON.as_bytes()
        );
        let summary_bytes = fs::read(directory.join("summary.json")).unwrap();
        let summary: serde_json::Value = serde_json::from_slice(&summary_bytes).unwrap();
        let cadence = c
            .cadence(summary["cadence_profile"].as_str().unwrap_or("20hz"))
            .unwrap();
        let expected_ticks = cadence
            .ticks_for_seconds(c.warmup_seconds + c.measurement_seconds)
            .unwrap();
        assert_eq!(
            summary["status"], "PASSED",
            "{profile} summary is not qualified"
        );
        assert_eq!(summary["mode"], "QUALIFY");
        assert_eq!(summary["environment"], "LOCAL");
        assert_eq!(summary["profile"], profile);
        assert_eq!(summary["repeats"], 3);
        assert_eq!(summary["warmup_seconds"], 30);
        assert_eq!(summary["measurement_seconds"], 180);
        assert_eq!(summary["run_ids"], serde_json::json!([1, 2, 3]));
        assert_eq!(summary["artifact_hashes"].as_array().unwrap().len(), 3);
        summary_hashes.insert(profile, blake3::hash(&summary_bytes).to_hex().to_string());
        let public = readback(&directory, "benchmark_result");
        assert_eq!(public.len(), 1);
        let public = &public[0];
        assert_eq!(public["status"], "PASSED");
        assert_eq!(public["environment"], "LOCAL");
        assert_eq!(public["workload_profile"], profile);
        assert_eq!(public["evidence_hash"], summary_hashes[profile]);
        assert_eq!(public["build_hash"], build_hash);
        assert_eq!(public["configuration_hash"], summary["configuration_hash"]);
        assert_eq!(public["actor_count"], summary["population"]);
        assert_eq!(public["run_ids"], summary["run_ids"]);
        for (field, expected) in [
            ("tick_interval_us", cadence.tick_interval_us),
            ("bucket_count", u64::from(c.buckets)),
            ("warmup_seconds", 30),
            ("measurement_seconds", 180),
            ("repeat_count", 3),
            ("subscriber_count", c.viewers),
            (
                "offered_human_orders_per_second",
                c.offered_orders_per_second,
            ),
            ("skipped_application_slots", 0),
        ] {
            assert_eq!(public[field], expected);
        }
        let records = readback(&directory, "run_record");
        let validated = readback(&directory, "validated_run");
        assert_eq!((records.len(), validated.len()), (3, 3));
        let news = readback(&directory, "news_event");
        if profile == "NORMAL" {
            assert!(news.is_empty());
        } else {
            assert_eq!(news.len(), 1);
            assert_eq!(news[0]["direction"], -1);
            assert_eq!(
                news[0]["headline"],
                "ONE Industries admits its lunar revenue division does not actually exist."
            );
            assert_eq!(news[0]["start_tick"], c.chaos_slot - 1);
            // Wall-clock expiry records the actual final logical tick; an
            // exact logical span is not guaranteed by a 60-second deadline.
            let end = news[0]["end_tick"].as_u64().unwrap();
            assert!(end >= c.chaos_slot - 1);
            assert!(
                end <= c.chaos_slot + cadence.ticks_for_seconds(c.chaos_duration_seconds).unwrap()
            );
            assert_eq!(news[0]["severity_bps"], c.chaos_severity_bps);
            assert_eq!(news[0]["confidence_bps"], c.chaos_confidence_bps);
        }
        let mut worst_p99 = 0;
        let mut total_updates = 0u64;
        for repeat in 1..=3 {
            let prefix = directory.join(format!("{}-{repeat}", profile.to_lowercase()));
            let bytes = fs::read(prefix.with_extension("json")).unwrap();
            let a: Artifact = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(
                blake3::hash(&bytes).to_hex().as_str(),
                summary["artifact_hashes"][repeat - 1]
            );
            assert!([2, 3].contains(&a.format_version));
            assert_eq!(a.cadence_profile, cadence.id);
            assert_eq!(a.tick_interval_us, cadence.tick_interval_us);
            assert_eq!(a.mode, "QUALIFY");
            assert!(a.exploratory_metrics.is_none());
            assert_eq!(a.environment, "LOCAL");
            assert_eq!(a.profile, profile);
            assert_eq!(a.run_id, repeat as u64);
            let record = records.iter().find(|r| r["run_id"] == a.run_id).unwrap();
            assert_eq!(record["status"], "PASSED");
            assert_eq!(record["qualification"], true);
            assert_eq!(record["committed_ticks"], expected_ticks);
            assert_eq!(record["last_slot"], expected_ticks);
            assert_eq!(record["skipped_slots"], 0);
            assert_eq!(record["population"], a.population);
            assert_eq!(record["build_hash"], a.build_hash);
            assert_eq!(record["profile"], profile);
            assert_eq!(record["seed"], a.seed);
            assert_eq!(record["configuration_hash"], a.configuration_hash);
            let validated = validated.iter().find(|r| r["run_id"] == a.run_id).unwrap();
            assert_eq!(
                validated["evidence_hash"],
                summary["artifact_hashes"][repeat - 1]
            );
            assert_eq!(*population.get_or_insert(a.population), a.population);
            assert_eq!(summary["population"], a.population);
            assert_eq!(a.seed, c.seed);
            assert_eq!(a.build_hash, build_hash);
            assert_eq!(summary["build_hash"], build_hash);
            assert_eq!(
                a.configuration_hash,
                workload_hash_at_cadence(a.population, a.seed, profile, &cadence)
            );
            assert_eq!(summary["configuration_hash"], a.configuration_hash);
            assert_eq!((a.warmup_seconds, a.measurement_seconds), (30, 180));
            assert_eq!(
                (a.subscriber_count, a.offered_orders_per_second),
                (c.viewers, c.offered_orders_per_second)
            );
            assert_eq!(a.subscription_queries, c.observer_queries);
            assert!(
                a.confirmed_reads
                    && a.connections_healthy
                    && a.accounting_audit
                    && a.workload_maintained
            );
            assert!(a.initialization_us > 0);
            assert_eq!(a.build_metadata["harness_binary_blake3"].len(), 64);
            assert_eq!(
                &*build_metadata.get_or_insert_with(|| a.build_metadata.clone()),
                &a.build_metadata
            );

            assert_eq!(a.offers.len(), 1050);
            for (i, offer) in a.offers.iter().enumerate() {
                assert_eq!(offer.intended_offset_us, i as u64 * 200_000);
                assert_eq!(offer.side, if i % 2 == 0 { "BUY" } else { "SELL" });
                assert!(offer.accepted.is_some() && offer.round_trip_us.is_some());
                assert!(offer.lateness_us < 50_000);
                assert_eq!(
                    offer.offered_offset_us - offer.intended_offset_us,
                    offer.lateness_us
                );
                assert!(i == 0 || offer.id > a.offers[i - 1].id);
                assert!(!offer
                    .error
                    .as_deref()
                    .is_some_and(|e| e.starts_with("SDK error:") || e.starts_with("send error:")));
            }
            assert_eq!(a.receipts.len() as u64, expected_ticks);
            assert_eq!(a.receipt_arrival_times_us.len() as u64, expected_ticks);
            for (tick, (observed, _)) in a.receipt_arrival_times_us.iter().enumerate() {
                assert_eq!(*observed, tick as u64);
            }
            // Recompute all deadline, sequence, ordered membership, per-bucket
            // coverage, P99 and schedule-debt gates from retained raw receipts.
            let validation = evidence::validate_at_cadence(
                &a.receipts,
                a.run_id,
                a.population,
                a.origin_us,
                false,
                true,
                true,
                &cadence,
            );
            assert_eq!(
                validation.status, "PASSED",
                "{profile} repeat {repeat}: {:?}",
                validation.reasons
            );
            assert_eq!(
                serde_json::to_value(&validation).unwrap(),
                serde_json::to_value(&a.validation).unwrap()
            );
            assert_eq!(
                validated["measured_actor_updates"],
                validation.measured_actor_updates
            );
            assert_eq!(
                validated["start_lateness_p_99_us"],
                validation.start_lateness_p99_us
            );
            worst_p99 = worst_p99.max(validation.start_lateness_p99_us);
            total_updates += validation.measured_actor_updates;
            for epoch in a.receipts.chunks_exact(20) {
                assert_eq!(
                    epoch.iter().map(|r| r.actor_rows_updated).sum::<u64>(),
                    a.population
                );
            }
            let csv = fs::read_to_string(prefix.with_extension("csv")).unwrap();
            assert_eq!(csv.lines().count() as u64, expected_ticks + 1);
            assert_eq!(csv.lines().next().unwrap(), "run_id,slot,tick,intended_us,invoked_us,lateness_us,skipped,bucket,actor_steps,actor_updates,policy_evaluations,orders_submitted,orders_filled,matched_shares");
            for (line, r) in csv.lines().skip(1).zip(&a.receipts) {
                assert!(r.orders_filled <= r.orders_submitted);
                assert_eq!(
                    line,
                    format!(
                        "{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                        r.run_id,
                        r.intended_slot,
                        r.logical_tick,
                        r.intended_at_us,
                        r.invoked_at_us,
                        r.start_lateness_us,
                        r.skipped_slots,
                        r.bucket,
                        r.actor_steps,
                        r.actor_rows_updated,
                        r.policy_evaluations,
                        r.orders_submitted,
                        r.orders_filled,
                        r.matched_share_volume
                    )
                );
            }
            let start = a.origin_us + 30_000_000;
            let end = start + 180_000_000;
            let measured: Vec<_> = a
                .receipts
                .iter()
                .filter(|r| r.invoked_at_us >= start && r.invoked_at_us < end)
                .collect();
            assert_eq!(
                measured.len() as u64,
                cadence.ticks_for_seconds(c.measurement_seconds).unwrap()
            );
            let updates = measured.iter().map(|r| r.actor_rows_updated).sum::<u64>();
            assert_eq!(updates, validation.measured_actor_updates);
            reports.push(serde_json::json!({
                "profile":profile,"repeat":repeat,"population":a.population,
                "database":a.database,"initialization_us":a.initialization_us,
                "p99_start_lateness_us":validation.start_lateness_p99_us,
                "max_start_lateness_us":a.receipts.iter().map(|r|r.start_lateness_us).max(),
                "skipped_slots":validation.skipped_slots,"measured_actor_updates":updates,
                "actor_updates_per_second":updates as f64 / 180.0,
                "orders_per_second":measured.iter().map(|r|r.orders_submitted).sum::<u64>() as f64 / 180.0,
                "filled_orders_per_second":measured.iter().map(|r|r.orders_filled).sum::<u64>() as f64 / 180.0,
                "matched_shares_per_second":measured.iter().map(|r|r.matched_share_volume).sum::<u64>() as f64 / 180.0,
                "accepted_offers":a.offers.iter().filter(|o|o.accepted == Some(true)).count(),
                "configuration_hash":a.configuration_hash,"build_hash":a.build_hash
            }));
        }
        assert_eq!(public["start_lateness_p_99_us"], worst_p99);
        assert_eq!(public["committed_actor_updates"], total_updates);
        println!(
            "Verified {profile}: all three raw artifacts, hashes, CSVs and server readbacks agree."
        );
    }
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({"audit":"PASSED","build_hash":build_hash,"summary_hashes":summary_hashes,"runs":reports})).unwrap());
}
