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
