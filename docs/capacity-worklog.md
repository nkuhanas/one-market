# Local capacity optimization log

This is an in-progress investigation, not a new qualified capacity headline.
The original passing baseline is commit `f507b23`, annotated tag
`baseline/v02-local-200`; its six-run evidence remains under
`artifacts/baseline/20261003T200840Z-2571553/`. Its release WASM SHA-256 is
`863462dde83f39137100f91d946623a4f133643ac9975a78779f9d1349762ecd`.
No market configuration or qualification criteria have changed.

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
Pinned runtime source shows commit materializes old/new rows and maintains
indexes ([commit merge](https://github.com/clockworklabs/SpacetimeDB/blob/v2.10.1/crates/datastore/src/locking_tx_datastore/committed_state.rs)).
The next investigation is this row/commit cost, not a claim of a platform limit.
The additional `20261003-fixed-row-500k/perf.data` sample overlaps the end of the
run and audit; like the earlier native sample, it is not clean tick attribution.

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
between 337,500 and 350,000 on this host; 337,500 is the final qualification
candidate, not yet a qualified result.

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

## Reproduction

All commands are local. On this host prefix them with
`sudo -n env LOCAL_UID=1000 LOCAL_GID=1000` for Docker access.

```sh
POPULATION=500000 MODULE_WASM=artifacts/builds/baseline-v02.wasm ./scripts/explore
POPULATION=500000 MODULE_WASM=artifacts/builds/fixed-row.wasm ./scripts/explore
POPULATION=500000 PROFILE_TICKS=1 ./scripts/explore
POPULATION=500000 MODULE_WASM=artifacts/builds/fixed-row.wasm ./scripts/profile-native
POPULATION=337500 PROFILE=ALL ./scripts/benchmark
docker compose --project-directory . -f infra/docker-compose.yml run --rm --no-deps web \
  node scripts/report-capacity.mjs artifacts/exploration
```

Both measured WASM binaries are retained in `artifacts/builds/`, with hashes and
provenance. The original exploration harness binary also remains in the Docker
target volume; the script can rebuild a compatible decoder/harness from source.
The immutable tag also permits rebuilding the original source in a
separate worktree. Full 3× NORMAL + 3× CHAOS qualification remains required after
a materially improved knee and final-candidate bracketing; no new capacity has
yet been qualified.
