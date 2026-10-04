use crate::{
    bindings::*,
    client::{self, Client, Result},
    invoke,
};
use one_market_core::{
    config::{config, workload_hash, CONFIG_JSON},
    evidence::{self, Receipt, Validation},
};
use serde::{Deserialize, Serialize};
use spacetimedb_sdk::{Table, TableWithPrimaryKey};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(test)]
mod archive_tests;
mod health;

pub struct Options {
    pub uri: String,
    pub database: String,
    pub token: String,
    pub build_hash: String,
    pub population: u64,
    pub profile: String,
    pub environment: String,
    pub output: PathBuf,
    pub exploration: Option<crate::explore::Window>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Offer {
    pub id: u64,
    pub intended_offset_us: u64,
    pub offered_offset_us: u64,
    pub lateness_us: u64,
    pub side: String,
    pub accepted: Option<bool>,
    pub error: Option<String>,
    pub round_trip_us: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct Artifact {
    pub format_version: u32,
    pub mode: String,
    pub initialization_us: u64,
    pub exploratory_metrics: Option<crate::explore::Metrics>,
    pub database: String,
    pub environment: String,
    pub profile: String,
    pub run_id: u64,
    pub population: u64,
    pub seed: u64,
    pub configuration_hash: String,
    pub build_hash: String,
    pub runtime_version: String,
    pub build_metadata: BTreeMap<String, String>,
    pub confirmed_reads: bool,
    pub origin_us: i64,
    pub collection_finished_us: i64,
    pub subscriber_count: u64,
    pub subscription_queries: Vec<String>,
    pub offered_orders_per_second: u64,
    pub warmup_seconds: u64,
    pub measurement_seconds: u64,
    pub workload_maintained: bool,
    pub connections_healthy: bool,
    pub accounting_audit: bool,
    #[serde(default)]
    pub market_health: Option<health::Health>,
    pub validation: Validation,
    pub receipt_arrival_times_us: Vec<(u64, i64)>,
    pub offers: Vec<Offer>,
    pub receipts: Vec<Receipt>,
}

pub fn clock_us() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before epoch")
        .as_micros() as i64
}

fn metadata() -> Result<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    map.insert("rust_client_sdk".into(), "2.10.1".into());
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    map.insert(
        "harness_binary_blake3".into(),
        blake3::hash(&fs::read(executable).map_err(|e| e.to_string())?)
            .to_hex()
            .to_string(),
    );
    map.insert(
        "local_runtime_base_digest".into(),
        "sha256:5231fa24bc8eaa28b2a3c6a4725f1d31e6a868e2e9b311c8efa1ddc314466014".into(),
    );
    let rust = std::process::Command::new("rustc")
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;
    map.insert(
        "rust_toolchain".into(),
        String::from_utf8_lossy(&rust.stdout).trim().into(),
    );
    for (key, path) in [
        ("cargo_lock_blake3", "Cargo.lock"),
        ("module_source_blake3", "crates/spacetime/src/lib.rs"),
    ] {
        map.insert(
            key.into(),
            blake3::hash(&fs::read(path).map_err(|e| e.to_string())?)
                .to_hex()
                .to_string(),
        );
    }
    let bindings_path = if cfg!(feature = "probe-bindings") {
        "crates/benchmark/src/probe_bindings"
    } else {
        "crates/benchmark/src/bindings"
    };
    let mut bindings: Vec<_> = fs::read_dir(bindings_path)
        .map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    bindings.sort_by_key(|f| f.file_name());
    let mut hash = blake3::Hasher::new();
    for binding in bindings {
        hash.update(binding.file_name().to_string_lossy().as_bytes());
        hash.update(&fs::read(binding.path()).map_err(|e| e.to_string())?);
    }
    map.insert(
        "rust_bindings_blake3".into(),
        hash.finalize().to_hex().to_string(),
    );
    if let Ok(cpu) = fs::read_to_string("/proc/cpuinfo") {
        map.insert(
            "cpu_model".into(),
            cpu.lines()
                .find_map(|s| {
                    s.strip_prefix("model name")
                        .and_then(|s| s.split_once(':'))
                        .map(|(_, v)| v.trim().into())
                })
                .unwrap_or("unavailable".into()),
        );
    }
    map.insert(
        "visible_logical_cpus".into(),
        std::thread::available_parallelism()
            .map(|n| n.to_string())
            .unwrap_or("unavailable".into()),
    );
    let uname = std::process::Command::new("uname")
        .arg("-srmo")
        .output()
        .map_err(|e| e.to_string())?;
    map.insert(
        "kernel".into(),
        String::from_utf8_lossy(&uname.stdout).trim().into(),
    );
    Ok(map)
}

fn project(r: TickReceipt) -> Receipt {
    Receipt {
        run_id: r.run_id,
        intended_slot: r.intended_slot,
        logical_tick: r.logical_tick,
        intended_at_us: r.intended_at.to_micros_since_unix_epoch(),
        invoked_at_us: r.invoked_at.to_micros_since_unix_epoch(),
        start_lateness_us: r.start_lateness_us,
        skipped_slots: r.skipped_slots,
        schedule_debt_us: r.schedule_debt_us,
        bucket: r.bucket,
        actor_steps: r.actor_steps,
        policy_evaluations: r.policy_evaluations,
        actor_rows_updated: r.actor_rows_updated,
        membership_digest: r.membership_digest,
        previous_steps_valid: r.previous_steps_valid,
        orders_submitted: r.orders_submitted,
        orders_filled: r.orders_filled,
        matched_share_volume: r.matched_share_volume,
    }
}

fn save(path: &std::path::Path, artifact: &Artifact) -> Result<String> {
    let bytes = serde_json::to_vec_pretty(artifact).map_err(|e| e.to_string())?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    fs::write(path.with_extension("json"), bytes).map_err(|e| e.to_string())?;
    let mut csv=String::from("run_id,slot,tick,intended_us,invoked_us,lateness_us,skipped,bucket,actor_steps,actor_updates,policy_evaluations,orders_submitted,orders_filled,matched_shares\n");
    use std::fmt::Write;
    for r in &artifact.receipts {
        writeln!(
            csv,
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
        .map_err(|e| e.to_string())?;
    }
    fs::write(path.with_extension("csv"), csv).map_err(|e| e.to_string())?;
    Ok(hash)
}

fn host_metrics(options: &Options, repeat: u64, phase: &str) -> Result<()> {
    // Only outside exploratory measurement. These are host instrumentation,
    // never ctx.timestamp-based execution estimates. Preserve raw HELP labels.
    fn get(url: String) -> Result<Vec<u8>> {
        let output = std::process::Command::new("curl")
            .args([
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "10",
                &url,
            ])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err("host metrics HTTP request failed".into());
        }
        Ok(output.stdout)
    }
    let info: serde_json::Value = serde_json::from_slice(&get(format!(
        "{}/v1/database/{}",
        options.uri, options.database
    ))?)
    .map_err(|e| e.to_string())?;
    let identity = info["database_identity"]["__identity__"]
        .as_str()
        .ok_or("database identity unavailable")?
        .trim_start_matches("0x");
    let metrics = String::from_utf8(get(format!("{}/v1/metrics", options.uri))?)
        .map_err(|e| e.to_string())?;
    let filtered = metrics
        .lines()
        .filter(|line| {
            line.starts_with('#')
                || line.contains(identity)
                || line.starts_with("jemalloc_")
                || line.starts_with("page_pool_")
        })
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(
        options.output.join(format!("host-{repeat}-{phase}.prom")),
        filtered,
    )
    .map_err(|e| e.to_string())
}

pub fn run(options: Options) -> Result<bool> {
    let c = config();
    let warmup_seconds = options
        .exploration
        .map_or(c.warmup_seconds, |w| w.warmup_seconds);
    let measurement_seconds = options
        .exploration
        .map_or(c.measurement_seconds, |w| w.measurement_seconds);
    let repeats = options
        .exploration
        .map_or(c.confirmation_runs, |w| w.repeats);
    let qualification = options.exploration.is_none();
    let build_metadata = metadata()?;
    if options.population == 0 || options.population > c.population_max {
        return Err("invalid population".into());
    }
    if options.profile != "NORMAL" && options.profile != "CHAOS" {
        return Err("profile must be NORMAL or CHAOS".into());
    }
    fs::create_dir_all(&options.output).map_err(|e| e.to_string())?;
    fs::write(options.output.join("workload.json"), CONFIG_JSON).map_err(|e| e.to_string())?;
    let owner = Client::connect(
        &options.uri,
        &options.database,
        Some(options.token.clone()),
        client::control_queries(),
    )?;
    let initial = owner
        .db
        .db
        .runtime_config()
        .id()
        .find(&0)
        .ok_or("runtime missing")?;
    if initial.phase != "EMPTY" || initial.run_id != 0 {
        return Err(
            "qualification requires a new empty database; refusing to overwrite an existing world"
                .into(),
        );
    }
    let mut run_ids = vec![];
    let mut artifact_hashes = vec![];
    let mut all_passed = true;
    for repeat in 1..=repeats {
        if repeat > 1 {
            invoke!(owner, reset_market_then("RESET WORLD".into()))?;
            loop {
                invoke!(owner, reset_batch_then())?;
                if owner
                    .db
                    .db
                    .runtime_config()
                    .id()
                    .find(&0)
                    .is_some_and(|r| r.phase == "EMPTY")
                {
                    break;
                }
            }
        }
        let setup_started = Instant::now();
        invoke!(owner, set_actor_population_then(options.population, c.seed))?;
        loop {
            invoke!(owner, initialize_batch_then(c.setup_batch_max))?;
            if owner
                .db
                .db
                .runtime_config()
                .id()
                .find(&0)
                .is_some_and(|r| r.phase == "READY")
            {
                break;
            }
        }
        let initialization_us = setup_started.elapsed().as_micros() as u64;
        let mut viewers = vec![];
        for _ in 0..c.viewers {
            viewers.push(Client::connect(
                &options.uri,
                &options.database,
                None,
                client::public_queries(),
            )?);
        }
        let human = Client::connect(
            &options.uri,
            &options.database,
            None,
            ["my_trader", "my_pending_order", "my_recent_fills"]
                .iter()
                .map(|t| format!("SELECT * FROM {t}"))
                .collect(),
        )?;
        invoke!(human, enter_market_then())?;
        if !qualification {
            if let Err(e) = host_metrics(&options, repeat, "before") {
                eprintln!("Metrics unavailable: {e}");
            }
        }
        let arrivals = Arc::new(Mutex::new(vec![]));
        // Reuse the existing subscribed market row: no additional subscribers,
        // SQL scans or full actor reads during the measured window.
        let market_samples = Arc::new(Mutex::new(Vec::new()));
        let samples_callback = market_samples.clone();
        let sample_limit = c.tick_receipt_retention as usize;
        let market_callback = owner
            .db
            .db
            .market_state()
            .on_update(move |_, before, after| {
                if before.logical_tick != after.logical_tick {
                    let mut samples = samples_callback.lock().unwrap();
                    if samples.len() < sample_limit {
                        samples.push(health::Sample::from(after));
                    }
                }
            });
        let arrivals_callback = arrivals.clone();
        let expected_id = owner
            .db
            .db
            .runtime_config()
            .id()
            .find(&0)
            .ok_or("runtime missing")?
            .next_run_id;
        let callback = owner
            .db
            .db
            .detailed_benchmark_receipts()
            .on_insert(move |_, r| {
                if r.run_id == expected_id {
                    arrivals_callback
                        .lock()
                        .unwrap()
                        .push((r.logical_tick, clock_us()));
                }
            });
        invoke!(
            owner,
            start_run_then(
                options.profile.clone(),
                options.build_hash.clone(),
                qualification
            )
        )?;
        client::wait_until(
            || {
                owner
                    .db
                    .db
                    .run_record()
                    .run_id()
                    .find(&expected_id)
                    .is_some()
            },
            Duration::from_secs(10),
        )?;
        let record = owner
            .db
            .db
            .run_record()
            .run_id()
            .find(&expected_id)
            .ok_or("run missing")?;
        let expected_workload = workload_hash(options.population, c.seed, &options.profile);
        if record.configuration_hash != expected_workload {
            // A preserved WASM must be paired with its own frozen workload.
            // Do not label an old module's behavior with this harness's rules.
            let _ = invoke!(owner, pause_simulation_then());
            return Err(format!(
                "module/harness workload mismatch: runtime {}, harness {}; stopped before offering load",
                record.configuration_hash, expected_workload
            ));
        }
        let origin_us = record.origin.to_micros_since_unix_epoch();
        let now = Instant::now();
        let offset = origin_us - clock_us();
        let origin = if offset >= 0 {
            now + Duration::from_micros(offset as u64)
        } else {
            now.checked_sub(Duration::from_micros(offset.unsigned_abs()))
                .ok_or("clock offset out of range")?
        };
        let offers = Arc::new(Mutex::new(Vec::<Offer>::new()));
        let duration = warmup_seconds + measurement_seconds;
        let count = duration * c.offered_orders_per_second;
        println!("{} {} repeat {repeat}/{repeats}: {} actors, {warmup_seconds}s warmup + {measurement_seconds}s measurement, 10 viewers, 5 offered orders/s; run {}; initialization={}ms",if qualification {"QUALIFY"} else {"EXPLORE"}, options.profile,options.population,expected_id,initialization_us / 1000);
        for i in 0..count {
            let intended_offset_us = i * 1_000_000 / c.offered_orders_per_second;
            let deadline = origin + Duration::from_micros(intended_offset_us);
            if let Some(wait) = deadline.checked_duration_since(Instant::now()) {
                thread::sleep(wait);
            }
            let offered = Instant::now();
            let lateness = offered.saturating_duration_since(deadline).as_micros() as u64;
            let id = i + 1;
            let buy = i % 2 == 0;
            let side = if buy { "BUY" } else { "SELL" }.to_string();
            offers.lock().unwrap().push(Offer {
                id,
                intended_offset_us,
                offered_offset_us: offered.saturating_duration_since(origin).as_micros() as u64,
                lateness_us: lateness,
                side: side.clone(),
                accepted: None,
                error: None,
                round_trip_us: None,
            });
            let shared = offers.clone();
            let sent = human.db.reducers.place_order_then(
                id,
                side,
                1,
                if buy { 10100 } else { 9900 },
                move |_, result| {
                    let mut rows = shared.lock().unwrap();
                    let row = &mut rows[i as usize];
                    row.round_trip_us = Some(offered.elapsed().as_micros() as u64);
                    match result {
                        Ok(Ok(())) => row.accepted = Some(true),
                        Ok(Err(e)) => {
                            row.accepted = Some(false);
                            row.error = Some(e);
                        }
                        Err(e) => {
                            row.accepted = Some(false);
                            row.error = Some(format!("SDK error: {e:?}"));
                        }
                    }
                },
            );
            if let Err(e) = sent {
                let mut rows = offers.lock().unwrap();
                rows[i as usize].accepted = Some(false);
                rows[i as usize].error = Some(format!("send error: {e}"));
            }
            if i % (c.offered_orders_per_second * 30) == 0 {
                println!(
                    "  offered {i}/{count}; committed ticks {}",
                    owner
                        .db
                        .db
                        .run_record()
                        .run_id()
                        .find(&expected_id)
                        .map(|r| r.committed_ticks)
                        .unwrap_or(0)
                );
            }
        }
        let finished = client::wait_until(
            || {
                owner
                    .db
                    .db
                    .run_record()
                    .run_id()
                    .find(&expected_id)
                    .is_some_and(|r| {
                        if qualification {
                            r.completed_at.is_some()
                        } else {
                            r.last_slot >= duration * 20
                        }
                    })
            },
            Duration::from_secs(10),
        )
        .is_ok();
        // Capture runtime failure before the intentional exploratory stop. Never
        // use a shortened run to validate/publish a qualified BenchmarkResult.
        let failed_before_stop = owner
            .db
            .db
            .run_record()
            .run_id()
            .find(&expected_id)
            .is_some_and(|r| r.status == "FAILED");
        if !finished || !qualification {
            let _ = invoke!(owner, pause_simulation_then());
        }
        if !qualification {
            if let Err(e) = host_metrics(&options, repeat, "after") {
                eprintln!("Metrics unavailable: {e}");
            }
        }
        let _ = client::wait_until(
            || offers.lock().unwrap().iter().all(|o| o.accepted.is_some()),
            Duration::from_secs(5),
        );
        let healthy =
            finished && owner.healthy() && human.healthy() && viewers.iter().all(Client::healthy);
        owner
            .db
            .db
            .detailed_benchmark_receipts()
            .remove_on_insert(callback);
        let offers = offers.lock().unwrap().clone();
        let workload = offers.len() as u64 == count
            && offers
                .iter()
                .all(|o| o.lateness_us < 50_000 && o.accepted.is_some())
            && viewers.len() as u64 == c.viewers;
        let latest = owner
            .db
            .db
            .run_record()
            .run_id()
            .find(&expected_id)
            .ok_or("run disappeared")?;
        let mut receipts: Vec<_> = owner
            .db
            .db
            .detailed_benchmark_receipts()
            .iter()
            .filter(|r| r.run_id == expected_id)
            .map(project)
            .collect();
        receipts.sort_unstable_by_key(|r| r.logical_tick);
        // Full population audit occurs only after scheduled measurement has ended.
        let audit_client = Client::connect(
            &options.uri,
            &options.database,
            Some(options.token.clone()),
            ["actor_state", "human_trader", "grant_accounting"]
                .iter()
                .map(|t| format!("SELECT * FROM {t}"))
                .collect(),
        )?;
        let audit_ok = client::audit(&audit_client).is_ok();
        owner.db.db.market_state().remove_on_update(market_callback);
        let market_health = Some(health::summarize(
            market_samples.lock().unwrap().clone(),
            &audit_client,
        ));
        drop(audit_client);
        let exploratory_metrics = options.exploration.map(|window| {
            crate::explore::measure(
                &receipts,
                expected_id,
                options.population,
                origin_us,
                window,
                failed_before_stop || !audit_ok,
                workload,
                healthy,
            )
        });
        let validation = if let Some(metrics) = &exploratory_metrics {
            metrics.validation.clone()
        } else {
            evidence::validate(
                &receipts,
                expected_id,
                options.population,
                origin_us,
                latest.status == "FAILED" || !audit_ok,
                workload,
                healthy,
            )
        };
        let artifact = Artifact {
            format_version: 2,
            mode: if qualification { "QUALIFY" } else { "EXPLORE" }.into(),
            initialization_us,
            exploratory_metrics,
            database: options.database.clone(),
            environment: options.environment.clone(),
            profile: options.profile.clone(),
            run_id: expected_id,
            population: options.population,
            seed: c.seed,
            configuration_hash: workload_hash(options.population, c.seed, &options.profile),
            build_hash: options.build_hash.clone(),
            runtime_version: if options.environment == "LOCAL" {
                "2.10.1".into()
            } else {
                std::env::var("OBSERVED_RUNTIME_VERSION")
                    .unwrap_or("unavailable: managed runtime version not exposed".into())
            },
            build_metadata: build_metadata.clone(),
            confirmed_reads: true,
            origin_us,
            collection_finished_us: clock_us(),
            subscriber_count: c.viewers,
            subscription_queries: client::public_queries(),
            offered_orders_per_second: c.offered_orders_per_second,
            warmup_seconds,
            measurement_seconds,
            workload_maintained: workload,
            connections_healthy: healthy,
            accounting_audit: audit_ok,
            market_health,
            validation,
            receipt_arrival_times_us: arrivals.lock().unwrap().clone(),
            offers,
            receipts,
        };
        let hash = save(
            &options
                .output
                .join(format!("{}-{repeat}", options.profile.to_lowercase())),
            &artifact,
        )?;
        if finished && qualification {
            invoke!(
                owner,
                validate_run_then(expected_id, hash.clone(), workload, healthy)
            )?;
        }
        let status = owner
            .db
            .db
            .run_record()
            .run_id()
            .find(&expected_id)
            .ok_or("run missing")?
            .status;
        let passed = if qualification {
            artifact.validation.status == "PASSED" && status == "PASSED"
        } else {
            artifact.validation.status == "EXPLORE_PASS"
        };
        println!(
            "  {}: p99={}us, updates={}, skipped={}, load={}, audit={}; {}",
            artifact.validation.status,
            artifact.validation.start_lateness_p99_us,
            artifact.validation.measured_actor_updates,
            artifact.validation.skipped_slots,
            workload,
            audit_ok,
            artifact.validation.reasons.join("; ")
        );
        all_passed &= passed;
        run_ids.push(expected_id);
        artifact_hashes.push(hash);
        drop(human);
        drop(viewers);
    }
    let summary = serde_json::json!({"mode":if qualification {"QUALIFY"} else {"EXPLORE"},
        "warmup_seconds":warmup_seconds,"measurement_seconds":measurement_seconds,"repeats":repeats,
        "profile":options.profile,"population":options.population,"environment":options.environment,
        "status":if all_passed {if qualification {"PASSED"} else {"EXPLORE_PASS"}} else {"NOT_QUALIFIED"},"run_ids":run_ids,"artifact_hashes":artifact_hashes,
        "configuration_hash":workload_hash(options.population,c.seed,&options.profile),"build_hash":options.build_hash});
    let bytes = serde_json::to_vec_pretty(&summary).map_err(|e| e.to_string())?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    fs::write(options.output.join("summary.json"), bytes).map_err(|e| e.to_string())?;
    if all_passed && qualification {
        invoke!(
            owner,
            publish_benchmark_result_then(run_ids, options.environment, hash)
        )?;
    }
    Ok(all_passed)
}
