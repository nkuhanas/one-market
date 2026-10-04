# Local capacity optimization log

The highest population qualified locally for **both NORMAL and CHAOS is 325,000
persistent actors at 20 Hz**, with three fresh passing confirmations per profile.
337,500 qualified for NORMAL only; its CHAOS failures remain in the archive.
This is the highest tested passing combined candidate, not a universal limit or
a Maincloud result. The final search resolution was 12,500 actors.

The original passing baseline is commit `f507b23`, annotated tag
`baseline/v02-local-200`; its six-run evidence remains under
`artifacts/baseline/20261003T200840Z-2571553/`. Its release WASM SHA-256 is
`863462dde83f39137100f91d946623a4f133643ac9975a78779f9d1349762ecd`.
No market configuration or qualification criteria have changed.

## Scope and unchanged workload

Only the private actor storage representation was optimized. `config/v02.json`,
`crates/market-core/src` (policy, auction, arithmetic, scheduling and qualification
validation), `SPEC.md`, and `apps/web` are byte-for-byte unchanged from the
preserved baseline. Runtime changes translate the same actor status and optional
ticks to/from fixed-width storage; the indexed bucket query, membership digest,
previous-step check, and one final row update for every due actor remain.
The optional phase timers are compiled into diagnostic builds only, and those
builds refuse qualification. Public samples still expose the original types.

All full qualifications retain 20 Hz, 20 buckets, the same seed, 30s warm-up,
180s measurement, ten production-subscription viewers, five offered human
orders/second and confirmed reads. Cash/share audits run after measurement,
never in place of persistent actor updates. Failed confirmations are retained
and cannot be replaced with a selection of successful repeats.

Measurements are local to this Docker host: 12 visible logical CPUs on an AMD
Ryzen 9 9950X host, with no exclusive-core isolation claimed. Other machines and
Maincloud require their own qualification. No Maincloud deployment or stress
test was performed, and no existing database was deleted for this investigation.

## Original behavior

The baseline qualified 200 actors in three NORMAL and three CHAOS runs. Short
NORMAL probes retain the same ten viewers, five offered human orders/second,
confirmed reads, actor coverage checks and post-stop conservation audit, but use
5 seconds warm-up and 20 seconds measurement. They cannot publish qualification.

|         Actors | Probe P99 start lateness (µs) | Skipped slots | Result           |
| -------------: | ----------------------------: | ------------: | ---------------- |
|          2,000 |                         2,101 |             0 | exploratory pass |
|         10,000 |                         2,792 |             0 | exploratory pass |
|         50,000 |                         1,991 |             0 | exploratory pass |
|        200,000 |                         1,858 |             0 | exploratory pass |
|        250,000 |                        10,495 |             0 | exploratory pass |
|        300,000 |                        48,475 |             3 | fail             |
|        500,000 |                        93,816 |           218 | fail             |
| 500,000 repeat |                        94,522 |           218 | fail             |
| 500,000 repeat |                        97,072 |           228 | fail             |

Raw JSON/CSV are under `artifacts/exploration/`. `scripts/report-capacity.mjs`
exports initialization time, order/fill rates, wall-time actor-update rates,
reasons and exact hashes into `capacity.csv`. A failed run's rates never use
completed ticks as a substitute for elapsed wall time.

## Diagnosis before optimization

The first 500k probe's host metrics recorded 284 simulation transactions:
24.727 seconds total transaction elapsed time (87.1 ms/tick), with 15.100 seconds
inside WASM including host ABI calls (53.2 ms/tick). The separate transaction
update metric was 0.420 seconds (1.48 ms/tick). These are aggregate averages,
not P99 execution times. ABI timing counters were disabled, not zero cost.

A separate `profile-ticks` release build uses the SDK's host `Instant`-backed
`LogStopwatch`, sampling one tick per epoch and rotating buckets. Such a build
rejects qualification. Its 500k diagnostic run also failed (222 skips). Fourteen
sampled ticks averaged:

| Phase                                                                  | Host elapsed ms |
| ---------------------------------------------------------------------- | --------------: |
| Indexed actor selection, decoding, sorting                             |          16.556 |
| Coverage digest, policy, lifecycle preparation                         |          10.289 |
| Auction                                                                |           1.482 |
| Settlement, lifecycle finalization, actor writes                       |          24.875 |
| Human gather/settlement and bounded feeds/receipts/scheduling combined |           0.105 |

The full log and phase CSV are in
`artifacts/exploration/20261003T213346Z-2973201/500000-normal/`.
Native CPU sampling (`artifacts/profiling/20261003-baseline-500k/perf.data`)
also found row serialization prominent: 12.30% in generic value serialization,
9.45% in row BSATN conversion. This sample includes initialization/reset and
is supporting evidence, not a clean measured-window per-tick attribution.
Compression and index/commit work were also visible. There was no evidence here
that auction sorting or public-feed delivery was the dominant bottleneck.

## First experiment: fixed-layout private actor rows

Hypothesis, recorded before implementation: replace the private status string
and variable-size optional ticks with lossless fixed-width representations.
This targets measured serialization/read/write cost without eliminating any
actor field, changing policy or lifecycle, or reducing persistent updates.
Option encoding must retain the entire u64 range (including zero and MAX), not
reserve a sentinel. Public actor samples keep their existing string/Option API.

SpacetimeDB 2.10.1 has a fixed-layout BSATN conversion path for row types with
constant serialized length; differently sized sum variants and strings prevent
it. See the pinned [static-layout implementation](https://github.com/clockworklabs/SpacetimeDB/blob/v2.10.1/crates/table/src/static_layout.rs)
and [row read/write paths](https://github.com/clockworklabs/SpacetimeDB/blob/v2.10.1/crates/table/src/table.rs).
This is an application schema optimization using the existing runtime, not a
runtime fork or a claim about a platform limit. Existing worlds must not be
automatically reset or overwritten to accommodate its private schema change.

## Fixed-layout experiment results

The first optimized release WASM is
`2b3b53fd6f709de7236c600d970805cf35dd80f8c75fd2cb29085048a55dcbcb`.
The same 500k NORMAL 5+20-second probe still failed in both repeats, but improved
from 274–281k to 349–355k committed actor updates/second. Skips fell from
218–228 to 142–151. P99 lateness was 80,825/74,909 µs. Both runs maintained load
and passed the cash/share audit. Raw evidence is under
`artifacts/exploration/20261003T214332Z-3027488/500000-normal/`.
Average transaction elapsed time fell from 87–90 ms to 68–70 ms, while average
WASM including ABI fell from 53–55 ms to 38–39 ms. WASM allocated memory fell
from 11,927,552 to 11,337,728 bytes; this is not total database memory.

A matching diagnostic probe (`20261003T214551Z-3039486`) measured 18 sampled
ticks: selection/read/sort 10.922 ms, policy/coverage/lifecycle 9.469 ms,
auction 1.465 ms, settlement/final actor write 14.618 ms. Compared with the
original diagnostic probe, reads fell 34% and writes/settlement 41%. No policy,
auction or coverage algorithm was removed or changed. Substantial transaction
work still occurs outside WASM; it is not equivalent to disk latency.

Subscription/serialization counters from the first original and fixed 500k
production probes (`20261003T212432Z-2926844` and `20261003T214332Z-3027488`)
also separate client-facing work from actor-row cost. Before/after counter
deltas give mean WebSocket serialization of 18.075 / 17.992 µs per message
(3,615 / 4,511 messages), and mean subscription-update lock wait of
0.203 / 0.250 µs (411 / 486 observations). Reducer-plus-query elapsed time
averaged 88.557 / 69.683 ms per simulation tick. Send-queue gauges were zero at
both endpoint snapshots; that does not rule out transient queues. These metrics
are not end-to-end delivery latency or evidence of a network ceiling. Raw
`host-1-before.prom` / `host-1-after.prom` retain the metric definitions and
counts. The diagnostic bounded feed/receipt/scheduling phase averaged 0.081 ms
after optimization; it is separate from outgoing-message serialization.

Pinned runtime source shows commit materializes old/new rows and maintains
indexes ([commit merge](https://github.com/clockworklabs/SpacetimeDB/blob/v2.10.1/crates/datastore/src/locking_tx_datastore/committed_state.rs)).
The next investigation is this row/commit cost, not a claim of a platform limit.
The additional `20261003-fixed-row-500k/perf.data` sample overlaps the end of the
run and audit; like the earlier native sample, it is not clean tick attribution.

The same 500k NORMAL workload provides the before/after comparison below.
Throughput/skips are from uninstrumented production builds; phase timings are
from the separate diagnostic builds. Ranges describe observed repeats, not
confidence intervals, and neither build qualified at 500k.

| Measurement                           |  Original | Fixed-width actor rows |
| ------------------------------------- | --------: | ---------------------: |
| Committed actor updates / wall second |  274–281k |               349–355k |
| Skipped slots (5+20s probes)          |   218–228 |                142–151 |
| Mean host transaction time            |  87–90 ms |               68–70 ms |
| Sampled selection/read/sort           | 16.556 ms |              10.922 ms |
| Sampled settlement/final actor write  | 24.875 ms |              14.618 ms |
| Sampled auction                       |  1.482 ms |               1.465 ms |

Verification after the optimization: `scripts/check` passed formatting, lint,
types, builds, Clippy, binding freshness, seven core tests, three runtime tests,
and exploration tests. All twelve real-runtime backend tests passed. The two
browser tests and persistent-state/single-scheduler restart checks passed using
`SPACETIMEDB_DATABASE=one-market-v02-fixed-local ./scripts/smoke`.
The old database was not migrated or reset. The private schema requires a fresh
named world or a deliberate future migration; public observer/human APIs remain
unchanged. The encoding round-trip test covers all status variants and None,
Some(0), Some(20), Some(MAX) in both optional tick fields, with constant byte size.

## Bracket and follow-up profile

The original build passed 250k and failed 300k (three skipped slots despite
P99 below 50 ms). The fixed-row build passed 350k (P99 32,075 µs, zero skips),
failed 375k (54,227 µs, 15 skips), and failed 400k (60,580 µs, 40 skips).
These are short NORMAL probes, not full qualifications. Longer 350k probes
use 30s warm-up and 90s measurement, so CHAOS reaches its unchanged intended
slot 1,200 and the shock is not moved earlier to fit the test.
Both longer 350k probes failed: NORMAL had five skipped slots (P99 44,532 µs),
CHAOS had two (42,084 µs). Load, client health, and conservation all passed.
The corresponding folders are `20261003T215709Z-3104247/350000-normal` and
`20261003T215935Z-3116358/350000-chaos`. The next probe narrows the bracket in
12,500-actor increments; a good P99 does not excuse a single skipped slot.
At 337,500 actors, both 30+90s probes passed, each committing 30,375,000 measured
actor updates with zero skipped slots. NORMAL P99 was 24,523 µs and CHAOS was
26,976 µs; both maintained offered/viewer load, healthy connections, and cash/share
conservation. Evidence is in `20261003T220208Z-3130808/337500-normal` and
`20261003T220413Z-3140786/337500-chaos`. This brackets the longer-probe boundary
between 337,500 and 350,000 on this host; 337,500 was selected as the first full
qualification candidate.

The full candidate archive is `artifacts/baseline/20261003T220900Z-3162127/`.
All three NORMAL runs passed (P99 24,295 / 23,552 / 22,990 µs, zero skips and
60,750,000 measured actor updates each). The first CHAOS confirmation failed:
one slot was skipped at intended slot 545, with start lateness 82,608 µs.
This happened during warm-up, before the fixed CHAOS event at slot 1,200, and
cannot be attributed to shock-induced trading. The preceding three slots had
roughly 1.4–1.7 ms lateness. P99 was still 24,007 µs and load/conservation passed,
but the zero-skip gate correctly rejected the run. The cause of this isolated
tail event is not established by start timestamps alone. CHAOS repeat two passed
(22,599 µs P99); repeat three failed with one skipped slot at slot 3,926
(54,435 µs lateness, 23,664 µs P99). Both maintained load and passed conservation.
All six confirmations are retained. The server published a NORMAL result at
337,500 but no CHAOS result, as verified by readback. The separate archive audit
validated the NORMAL files/readbacks and correctly rejected the combined archive
at CHAOS `NOT_QUALIFIED`. A combined NORMAL+CHAOS qualification now requires a
lower candidate; the next 12,500-actor step is 325,000. The successful NORMAL-only
result must not be relabeled as a pass for both profiles.

The 325,000-actor 30+90s probes both passed with zero skipped slots and
29,250,000 measured actor updates each. NORMAL P99 was 14,807 µs and CHAOS P99
was 15,712 µs. Offered/viewer load, confirmed-read connection health, and the
conservation audit passed in both. Initialization took 1,505 / 1,424 ms.
Evidence is in `20261003T223636Z-3297714/325000-normal` and
`20261003T223841Z-3307679/325000-chaos`. The next full six-run candidate is
325,000; these two exploratory passes alone did not qualify it. The full result
is recorded below.

An additional original-build 500k probe using the newly regenerated isolated
decoder reproduced failure: P99 90,744 µs, 217 skips, 282,490 updates/second.
This checks that before/after comparison still works after the schema change.

`scripts/profile-native` starts CPU sampling from the harness's first offered
order, before any teardown or audit. Its clean fixed-row sample is retained at
`artifacts/profiling/20261003T215515Z-3094418/`. Capture timestamps independently
place it from +0.001s through +16.274s of the 25s run; the raw evidence is in
`artifacts/exploration/20261003T215536Z-3094558/500000-normal/`.
No compilation, setup, reset, or full-actor audit occurs during this capture.
It contains 5,495 samples and no lost samples. Known native symbols include:
row-to-product serialization (4.48%), commit merge (3.85%), indexed row collection
(3.04%), unique-index insert/lookup/delete (2.35%/1.92%/1.38%), and WASM memory
copy (1.51%). Allocator/free functions are visible but no individual allocation
symbol dominates this CPU sample. These are all-thread CPU sample shares,
not transaction wall-time percentages or allocation counts. Compression work
also runs on persistence threads; sampling it does not prove it blocks ticks.
Unsymbolized JIT frames prevent exact native attribution of every WASM function;
the host-backed phase timers provide the policy/coverage and auction timings.

The current measured next bottleneck remains the per-actor row access and
transaction commit path, with indexed persistence and intermediate row-value
construction still substantial. There is no measured proof of a scheduler-only,
viewer-delivery, disk-bandwidth, or universal SpacetimeDB actor limit here.

## Final local qualification

`artifacts/baseline/20261003T224614Z-3341112/` contains the full 325,000-actor
qualification. All three NORMAL and all three CHAOS confirmations passed on
their first six-run invocation, with the unchanged 30+180s workload. Each run
retains 4,200 committed receipts, including 3,600 measured ticks and exactly
58,500,000 measured actor updates. All six maintained the ten viewers and five
offered orders/second, used confirmed reads, had healthy connections and zero
skipped slots, and passed the cash/share conservation audit. That is 351,000,000
measured updates across the six runs.

| Profile / repeat | P99 start lateness (µs) | Skips | Actor updates/s | Submitted orders/s | Filled orders/s | Initialization (ms) |
| ---------------- | ----------------------: | ----: | --------------: | -----------------: | --------------: | ------------------: |
| NORMAL 1         |                  15,616 |     0 |         325,000 |            243,976 |         237,105 |           1,657.559 |
| NORMAL 2         |                  16,938 |     0 |         325,000 |            243,941 |         237,090 |           1,441.199 |
| NORMAL 3         |                  19,001 |     0 |         325,000 |            244,000 |         237,127 |           1,469.486 |
| CHAOS 1          |                  17,746 |     0 |         325,000 |            284,784 |         150,882 |           1,526.853 |
| CHAOS 2          |                  19,924 |     0 |         325,000 |            284,193 |         153,802 |           1,482.805 |
| CHAOS 3          |                  17,889 |     0 |         325,000 |            285,111 |         150,002 |           1,450.644 |

Order rates are rounded here; exact rates and matched-share rates are in
`archive-audit.txt`. Rates count committed receipts within the fixed 180-second
server-invocation timestamp window, not completed ticks treated as elapsed time
or exact commit-completion timestamps. The worst individual start lateness was
48,380 µs in CHAOS repeat two. These finite confirmations establish the specified
qualification, not an indefinite zero-miss service-level guarantee.

The independent read-only archive audit passed both profiles: exact workload
bytes, module SHA-256, consistent build metadata, artifact and summary BLAKE3
hashes, CSV/JSON parity, original receipt validation, bucket coverage, every
offered order and receipt arrival, public result and private run/validation
readbacks, and the retained CHAOS event's direction/severity/confidence/timing.
The same audit correctly rejects the failed 337,500 combined archive.

- Module SHA-256: `2b3b53fd6f709de7236c600d970805cf35dd80f8c75fd2cb29085048a55dcbcb`.
- Harness binary BLAKE3: `ac7cdee83e766d6437c4447cea1ccff40f8d2682f925571a326f75f1f6ad4ba3`.
- NORMAL workload hash: `9f87a3af48554edc01bc6d1920fc9208907515a17f95e6278d8841d1f2be0451`.
- CHAOS workload hash: `81d541c7012a89621a87760ed6994541c126ff94296e7fc39f343c096948d3d8`.
- NORMAL summary hash: `472f4147cfafede2af9abf3f5110ce8dee974706b7988288f777592e9fe58654`.
- CHAOS summary hash: `fe3b4e0b116fdf243d19461c0e1b335c4fe8c0097f7fc3974bc948fcd997f064`.

The next likely bottleneck is still actor-row serialization/materialization,
index maintenance and transaction commit work. At the boundary, rare deadline
tails also matter: the cause of the isolated 337,500 misses is not established.
Further work should measure end-to-end commit and deadline tails before choosing
another optimization; these data do not isolate disk bandwidth, scheduler
contention or client delivery as the limiting resource. Native CPU sampling
exposes allocation/free work, but does not count allocations, and unsymbolized
JIT frames limit exact attribution. No reduction in writes or load is justified.

## Final regression and preservation checks

After all measurement stopped, `scripts/check` passed formatting, lint,
TypeScript/Vite, twelve Rust unit tests, WASM/native Clippy, the release build
and both generated-binding comparisons. `scripts/backend-smoke` passed all
twelve real-runtime tests, including access control, rollback, coverage and
lifecycle. `scripts/smoke` passed both browser tests and verified persistent
state plus one scheduler across container recreation and republishing.
Logs are retained in `artifacts/verification/20261003-capacity/`.

The final archive audit passed again after that database restart. Its separate
negative check returned the expected exit 101 for the failed 337,500 archive
with `CHAOS summary is not qualified`; `archive-rejection.txt` records that
intentional rejection, not a regression-test failure. The archive test is
ignored by ordinary unit-test runs because it requires completed benchmark
artifacts, and was explicitly executed for both archives.

The rebuilt production module compares byte-for-byte equal to the preserved
optimized WASM. Git comparisons confirm the original baseline evidence, workload
configuration, market-core rules, spec and frontend are unchanged. This final
snapshot is tagged `capacity/local-325k` on `perf/local-capacity`. Commits, tags
and evidence remain local; nothing was pushed or deployed to Maincloud.

## Reproduction

All commands are local and run from the repository root. On this host Docker
requires the following prefix; on a Docker-enabled user account, use `env` in
place of `sudo -n env LOCAL_UID=1000 LOCAL_GID=1000`. The explicit database
selection keeps the old private schema's worlds intact.

```sh
capacity_run() { sudo -n env LOCAL_UID=1000 LOCAL_GID=1000 "$@"; }
capacity_run SPACETIMEDB_DATABASE=one-market-v02-fixed-local ./scripts/local-up
capacity_run ./scripts/check
capacity_run ./scripts/backend-smoke
capacity_run SPACETIMEDB_DATABASE=one-market-v02-fixed-local ./scripts/smoke

# Both 500k probes are expected to fail; retain their failures and compare rates.
capacity_run POPULATION=500000 MODULE_WASM=artifacts/builds/baseline-v02.wasm ./scripts/explore
capacity_run POPULATION=500000 MODULE_WASM=artifacts/builds/fixed-row.wasm ./scripts/explore
capacity_run POPULATION=500000 PROFILE_TICKS=1 ./scripts/explore
capacity_run POPULATION=500000 MODULE_WASM=artifacts/builds/fixed-row.wasm ./scripts/profile-native

capacity_run POPULATION=325000 PROFILE=NORMAL WARMUP_SECONDS=30 MEASUREMENT_SECONDS=90 ./scripts/explore
capacity_run POPULATION=325000 PROFILE=CHAOS WARMUP_SECONDS=30 MEASUREMENT_SECONDS=90 ./scripts/explore
capacity_run POPULATION=325000 PROFILE=ALL ./scripts/benchmark
# For a new run, substitute the archive folder printed by benchmark.
capacity_run ./scripts/audit-capacity artifacts/baseline/20261003T224614Z-3341112
capacity_run docker compose --project-directory . -f infra/docker-compose.yml run --rm --no-deps web \
  node scripts/report-capacity.mjs artifacts/exploration
```

Both measured WASM binaries are retained in `artifacts/builds/`, with hashes and
provenance. The original exploration harness binary also remains in the Docker
target volume; the script can rebuild a compatible decoder/harness from source.
The immutable tag also permits rebuilding the original source in a
separate worktree. The final candidate was qualified with a non-diagnostic build;
no builds, profiling or smoke/restart checks ran concurrently with measurement.
Re-auditing live readbacks requires the retained named benchmark databases; a
fresh clone can reproduce them by running `benchmark` and auditing its new folder.

## Follow-up delta: controls and CI escalation (2026-10-04 UTC)

The sections above describe the preserved fixed-row capacity snapshot. The
subsequent merged frontend changes are retained unchanged in this follow-up.
Implementation of the [timestamped delta](../deltas/actor-capacity-optimization_2026-10-03_20-57-22_EST.md)
is incomplete in draft [PR #3](https://github.com/nkuhanas/one-market/pull/3).
At the initial controls checkpoint, no direct-index or digest change had been
implemented and no new capacity had been qualified. The module, specification,
workload, bindings, and frontend were unchanged from upstream base `cbcf187`.
Later implementation and transport results are recorded below.

Fresh controls used the same preserved fixed-row WASM, hash
`2b3b53fd6f709de7236c600d970805cf35dd80f8c75fd2cb29085048a55dcbcb`, and existing
production harness. Each uninstrumented NORMAL population used two fresh runs
with 5s warm-up, 20s measurement, ten viewers, five offered orders/sec, confirmed
reads, coverage validation and a post-run conservation audit.

|  Actors | P99 start lateness, repeats 1 / 2 (µs) | Skips, repeats 1 / 2 | Short-probe result | Archive under `artifacts/exploration/` |
| ------: | -------------------------------------: | -------------------: | ------------------ | -------------------------------------- |
| 325,000 |                        20,506 / 19,391 |                0 / 0 | Both pass          | `20261004T021322Z-124451`              |
| 337,500 |                        13,814 / 18,188 |                0 / 0 | Both pass          | `20261004T021425Z-129660`              |
| 350,000 |                        37,745 / 37,201 |                0 / 0 | Both pass          | `20261004T021528Z-135023`              |
| 500,000 |                        68,956 / 74,801 |            135 / 139 | Both fail          | `20261004T021631Z-140356`              |

Both 500k failures retained offered load and passed the conservation audit;
measured updates were 7,274,786 and 7,175,090 over 20 wall seconds. These failed
rates are comparisons for future experiments, not capacity claims.

A separate 350k CHAOS 30+90s diagnostic passed with P99 25,151 µs, no skips,
31,500,000 measured updates, maintained load and passing conservation. It did
not reproduce the earlier isolated deadline misses. The process sampler retained
1,131 approximately 100ms samples and correlated 2,396 receipt windows. Its
largest lateness was 35,700 µs; the surrounding 318ms process-wide sample window
included one major fault, about 88 MB of writes, 377ms summed thread CPU time,
and 2.72ms summed thread runqueue time. The windows overlap and include other
runtime work: these observations do not prove a storage or scheduler cause.
Thread churn also limits interpretation of aggregate scheduler counter deltas.
The instrumented run cannot qualify capacity.

Reproduction (using the `capacity_run` prefix above):

```sh
capacity_run POPULATION=350000 PROFILE=CHAOS MODULE_WASM=artifacts/builds/fixed-row.wasm \
  HARNESS_BIN=target/release/one-market-benchmark ./scripts/profile-deadlines
capacity_run docker compose --project-directory . -f infra/docker-compose.yml run --rm --no-deps web \
  node scripts/report-deadlines.mjs artifacts/profiling/deadlines-20261004T021050Z-102855 \
  artifacts/exploration/20261004T021051Z-103017/350000-chaos/chaos-1.json
# Substitute each control population; failures are expected at 500k.
capacity_run POPULATION=500000 PROFILE=NORMAL REPEATS=2 MODULE_WASM=artifacts/builds/fixed-row.wasm \
  HARNESS_BIN=target/release/one-market-benchmark ./scripts/explore
```

The pause-test change uses owner-authorized HTTP SQL reads and bounded cache
synchronization. It passed local static checks and three fresh 24-test backend
runs, including twelve new regression cases. CI nevertheless found persistent
divergence: server tick 60, disabled/generation 2/FAILED/no schedule, versus cache
tick 60, enabled/generation 1/RUNNING/one schedule after five seconds. The failure
is retained rather than hidden with retries or weakened assertions.

The installed TypeScript SDK 2.10.1 decompresses WebSocket messages concurrently
before its inbound queue. A controlled diagnostic using the unmodified adapter
and real gzip payloads reversed callback order in ten of ten mixed gzip/plain
trials; ten plain/plain controls preserved order. This proves an SDK ordering
defect and provides a strong hypothesis for CI, but no CI wire trace was captured
to prove that causal link. Evidence, source hashes, logs and reproduction code
are in `artifacts/verification/20261004-actor-capacity/`.

The PR remained unmerged at this checkpoint. The scope decision was whether to
extend shared client transport ordering or use
an explicitly documented test-only uncompressed transport workaround. No SDK
patch, dependency upgrade, compression change, or frontend transport change has
been made at that point. The user subsequently authorized the shared transport
extension below; final qualification remains pending.

## Shared transport extension (2026-10-04 UTC)

The user authorized extending PR #3 to fix production client ordering, not just
disable compression in tests. `@one-market/transport` serializes raw frames
before decompression for both TypeScript clients through `withWSFn`. It keeps
gzip, confirmed reads, token exchange, and SpacetimeDB 2.10.1. The frontend
change is connection lifecycle only; visual design and runtime semantics are
unchanged. Closing cancels queued work, and corrupt frames fail closed.

Local validation of this checkpoint passed `scripts/check`, all 33 backend and
transport tests, and all three browser smoke tests, including mixed gzip/plain
wire ordering. Smoke used the fresh `one-market-v02-delta-smoke` world and
verified persistent tick plus one scheduler after restart and republish. Logs:
`artifacts/verification/20261004-actor-capacity/{check-transport,backend-transport-1,smoke-transport}.txt`.
Both [push CI](https://github.com/nkuhanas/one-market/actions/runs/37171331525)
and [PR CI](https://github.com/nkuhanas/one-market/actions/runs/37171333193)
passed at `8e52986`, including all 33 backend/transport cases and three browser
cases. The pinned-SDK reproduction remains as negative evidence. Final CI must
be checked again on the retained capacity implementation.

## Independent direct-index experiment (2026-10-04 UTC)

The production candidate `2b6afc4` changes only the private actor primary-key
index to direct addressing. The bucket B-tree, explicit actor ordering, row
writes and digest remain unchanged. Preserved WASM:
`artifacts/builds/capacity-delta/direct-index.wasm`, SHA-256
`055bb41343a998a16aa9d8b78fa90572601a8508b70aef33323604d61126b4ef`.
Bindings were regenerated and are byte-identical. Static checks and all 24
pre-transport backend tests passed, followed by the transport validation above.

The same baseline Rust harness (`ac7cdee8...`) ran two 5+20s NORMAL probes at
each population with unchanged viewer/offered load, seed and gates. No compile,
smoke or profiling process ran during measurement. The fresh smoke world was
paused first; prior development worlds were retained. This shared host is not
exclusive, so repeat comparisons are evidence, not universal speedup guarantees.

|  Actors | P99 µs, repeats 1 / 2 |   Skips | Result    | Archive under `artifacts/exploration/` |
| ------: | --------------------: | ------: | --------- | -------------------------------------- |
| 325,000 |         2,781 / 3,953 |   0 / 0 | Both pass | `20261004T023159Z-226516`              |
| 337,500 |         2,143 / 4,967 |   0 / 0 | Both pass | `20261004T023301Z-231787`              |
| 350,000 |         5,901 / 9,882 |   0 / 0 | Both pass | `20261004T023403Z-237018`              |
| 500,000 |       59,185 / 58,823 | 63 / 70 | Both fail | `20261004T023505Z-242329`              |

500k committed throughput was 435,017 and 431,250 updates/wall second versus
363,739 and 358,755 in the matched baseline controls. Load and conservation
passed even on the failed runs. Lower short-run lateness and improved failure
throughput justify retaining the index for combined testing, not claiming
qualified higher capacity. Full qualification is still required.

`scripts/check-index-migration` published the fixed-row baseline to a fresh
named world, initialized 200 actors, started/paused a run, and republished the
direct-index module with `--delete-data=never`. The runtime removed the B-tree
primary-key index and created the direct index without deleting rows. All eight
checked tables matched exactly after sorting rows and preserving integer text.
Result: `artifacts/verification/index-migration-20261004T023640Z-250562/result.txt`;
the raw private-row snapshots stay ignored locally, not committed. The first
script attempt stopped on an output-directory permission error before migration;
that log and world are retained. No existing development world was migrated.

The digest-only experiment uses the baseline B-tree primary key and preserves
the exact hash chain while removing per-actor digest allocations. Its two new
equivalence tests cover empty/single/multiple/boundary IDs and all buckets at
20, 200, 325k, 337.5k, 350k and 500k. `scripts/check` passed with unchanged
bindings. Preserved digest-only SHA-256:
`814625047ade3b0fa8833ad2fbeeda0b967800a6c51ffce5eb0b1703e62d8e40`.
Matched comparison (same 5+20s NORMAL windows and baseline harness):

|  Actors | P99 µs, repeats 1 / 2 |     Skips | Result    | Archive under `artifacts/exploration/` |
| ------: | --------------------: | --------: | --------- | -------------------------------------- |
| 325,000 |       11,630 / 13,141 |     0 / 0 | Both pass | `20261004T023712Z-256186`              |
| 337,500 |       24,725 / 25,590 |     0 / 0 | Both pass | `20261004T023814Z-261446`              |
| 350,000 |       21,550 / 25,648 |     0 / 0 | Both pass | `20261004T023916Z-266714`              |
| 500,000 |       71,095 / 72,268 | 132 / 136 | Both fail | `20261004T024019Z-271960`              |

At 500k, digest-only throughput was 367,487 / 361,242 updates/sec: the paired
mean is only 0.86% above controls. Mean host transaction time fell from
66.73 / 67.56 ms to 66.16 / 66.94 ms, while mean WASM time fell from
36.86 / 36.92 ms to 35.81 / 36.15 ms. P99 lateness was mixed across populations;
these two non-interleaved repeats do not establish a robust capacity gain.
At 350k, mean transaction time fell from 46.39 / 46.49 to 43.54 / 44.09 ms.
In contrast, index-only 350k means were 36.54 / 37.50 ms, a larger reduction.
All variants reported identical WASM memory snapshots (6 MiB at 325k;
10.8125 MiB at the other populations), not total runtime/database memory.
Per-run initialization and complete host summaries are retained in each
archive's `capacity.csv`. Combined testing will decide whether the smaller
digest improvement survives alongside direct indexing.

Reproduction uses the exact frozen modules and the control harness hash above:

```sh
# Repeat for 325000, 337500, 350000, 500000; retain nonzero exits at 500k.
capacity_run POPULATION=350000 PROFILE=NORMAL REPEATS=2 \
  MODULE_WASM=artifacts/builds/capacity-delta/digest-only.wasm \
  HARNESS_BIN=target/capacity-control-harness ./scripts/explore
capacity_run ./scripts/check-index-migration
```

The harness was copied from `target/release/one-market-benchmark` before the
digest edits were compiled; its recorded BLAKE3 matches the baseline controls.
The copy is a local cache convenience, not a prerequisite for future builds;
rebuilding the harness at the retained baseline source must reproduce the
recorded identity for an exact matched comparison. Module hashes and source
commits are in `artifacts/builds/capacity-delta/provenance.json`. No performance
claim is based on the source filename or an assumed module identity.

## Combined result and retention decision

Combined candidate `4f84bca` / WASM `d13c1a9f...` used the identical paired
5+20s workload and control harness:

|  Actors | P99 µs, repeats 1 / 2 |   Skips | Result    | Archive under `artifacts/exploration/` |
| ------: | --------------------: | ------: | --------- | -------------------------------------- |
| 325,000 |         2,155 / 3,106 |   0 / 0 | Both pass | `20261004T024226Z-282886`              |
| 337,500 |        5,147 / 10,020 |   0 / 0 | Both pass | `20261004T024328Z-288209`              |
| 350,000 |         7,075 / 5,241 |   0 / 0 | Both pass | `20261004T024430Z-293463`              |
| 500,000 |       64,084 / 59,565 | 61 / 64 | Both fail | `20261004T024533Z-298816`              |

At 500k the combined build delivered 437,510 / 436,262 updates/sec, versus
index-only 435,017 / 431,250. The paired mean difference is only 0.87%.
Mean WASM time improved from 33.36 / 33.65 to 32.35 / 32.34 ms, but total
transaction means changed only from 55.51 / 56.37 to 55.23 / 55.54 ms.
At 337.5k, both combined transaction means and P99 lateness were worse than
index-only. There was no memory-snapshot reduction or change in pass/fail
boundaries. All raw receipts, failed probes and initialization costs are kept.

Decision: **keep the direct index; do not retain the digest production change**.
The sub-1% failure-throughput difference and mixed tails do not establish a
reliable capacity benefit from these non-interleaved paired runs. The candidate
builds/source commits remain reproducible; equivalence fixtures remain test-only.
This rejects an inconclusive optimization, not the correctness of fixed arrays.
The retained production digest, coverage and persistence representation are
unchanged from the fixed-row baseline.

The next candidate is 375,000 actors, using longer 30+90s NORMAL and CHAOS probes
before any full qualification. This is a measured-selection exercise above the
350k short controls, not an assertion that 375k passes or is the platform ceiling.
