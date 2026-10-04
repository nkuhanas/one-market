# Lossless compact actor storage and host write pressure

Status: implemented and locally verified; not deployed. Branch:
`perf/compact-actor-storage`, based on the retained actor-cost patch (`f305566`).
No Maincloud tier change, production reset, deployment, or frontend change.

## Evidence and hypothesis

The previous 1M-actor, 5 Hz Maincloud probe completed 705 ticks in three minutes
(3.917 Hz), with 194 skipped slots. Sampled reducer bodies averaged 144.895 ms,
but start intervals averaged 255.336 ms. Long gaps recurred approximately every
82 ticks; one 718.140 ms gap followed a 143.522 ms reducer body. Reducer CPU alone
does not explain that tail.

SpacetimeDB's [commit-log description](https://spacetimedb.com/docs/reference/internals/commitlog/)
documents full inserted/deleted row payloads and a default 1 GiB segment size.
At roughly 50k actor updates per tick, a 132-byte row produces approximately
13.2 MB of actor delete/insert payload per tick; 1 GiB holds about 81 ticks.
This matches the observed periodicity, but is a hypothesis, not proof of the
managed server's configuration or cause. We will not disable durability,
confirmed reads, or required actor updates to improve a benchmark.

## Change

- Add a private fixed-width 74-byte actor representation alongside the existing
  132-byte table. Keep IDs and tick values at full width; checked packing of
  ordinary balances, weights, counters, and flags reduces serialization and
  whole-row commit-log payload by about 44% for fitting actors.
- Keep the logical actor model, policy, financial arithmetic, bucket membership,
  coverage, and public interface unchanged. Values outside the compact range
  remain in the full-width table; a compact actor promotes atomically when a
  later update no longer fits. No clamps, lossy conversions, sentinel ticks,
  skipped updates, or cold-policy table joins.
- Each actor has exactly one authoritative row. Runtime bucket reads, reset,
  fixtures, and complete accounting/market-health audits include both tables.
  Carry the source representation with the loaded actor to avoid extra
  per-actor database lookups when writing.
- Fresh setup uses compact rows. Existing rows remain unchanged on ordinary
  `--delete-data=never` publication. An explicit owner-only, paused, bounded,
  idempotent migration can convert either direction without changing world
  state. Never deploy an old binary that cannot read compact rows; reverse
  migration first and retain compatible additive schema for rollback.

## Verification and acceptance

Test exact round trips and encoded lengths, every narrowing boundary, full-width
fallback, flags, mixed-store coverage, migration authorization and rollback,
preserved world/accounting state, and transaction rollback after actor writes.
Regenerate bindings; run Docker-backed check, backend integration, browser
smoke, and non-destructive upgrade/restart checks. Compare retained baseline
and candidate locally at 1M actors / 5 Hz, three viewers, and five offered human
orders per second, without overlapping builds or benchmark runs. Retain phase
timings, host metrics, receipts, conservation/coverage checks and limitations.

No new capacity claim follows from row size or a short local probe. Maincloud
stays paused; production effectiveness, especially host-side stalls, needs a
separately authorized bounded measurement after local acceptance. SPEC.md is
unchanged: physical encoding does not narrow the logical numeric domain.

## Results (2026-10-04)

Paired LOCAL NORMAL probes: 1M actors, 5 Hz, seed 20261003, three viewers,
five offered human orders/s, five-second warmup and 60-second measurement each.
Both passed coverage, workload, connectivity and full cash/share/population
audits; each measured exactly 15,000,000 actor updates with zero skipped slots.
No overlapping benchmarks or builds ran during either measurement. The initial
baseline launch stopped before initialization because the historical-probe
harness assumed all preserved binaries were 20 Hz-only; capability detection
now follows the selected generated schema, preserving old- and new-format audits.

| Metric                        |   Baseline |    Compact |                   Change |
| ----------------------------- | ---------: | ---------: | -----------------------: |
| Fixed-width encoded actor     |      132 B |       74 B |                   −43.9% |
| Actor rows in database pages  |     160 MB |      80 MB |                   −50.0% |
| Reducer bytes scanned / tick  |   6.605 MB |   3.705 MB |                   −43.9% |
| Reducer bytes written / tick  |   6.602 MB |   3.702 MB |                   −43.9% |
| Mean host reducer transaction | 114.300 ms | 101.832 ms |                   −10.9% |
| Mean WASM execution           |  65.798 ms |  62.680 ms |                    −4.7% |
| Transaction minus WASM        |  48.502 ms |  39.152 ms |                   −19.3% |
| Mean subscription update      |   2.874 ms |   2.879 ms |    essentially unchanged |
| Start-lateness p99            |  12.185 ms |   2.039 ms | short local samples only |
| Maximum start interval        | 226.673 ms | 200.830 ms | short local samples only |

Host counters cover warmup plus measurement (325 ticks) and include other
reducers for byte totals; they are not physical disk I/O counters. Transaction
minus WASM is not an isolated commit/fsync measurement. The sampled message-log
size gauge did **not** demonstrate a reduction in this probe (about 6.397 vs
6.477 MB growth/tick); it is not a cumulative write counter and can reflect
sampling lag/compression. Do not use it to claim measured WAL bandwidth savings.
The 44% uncompressed actor-payload reduction is directly tested, while the
Maincloud rotation/stall hypothesis remains unconfirmed.

Phase samples (16 each) put indexed selection/sort at 20.762 → 19.087 ms,
policy/lifecycle at 18.913 → 18.844 ms, settlement/final writes at
22.554 → 21.821 ms, and whole reducer bodies at 65.485 → 62.902 ms.
The larger gain is outside WASM, not a dramatic change in policy execution.
Both worlds retained 1M ACTIVE actors, no penny-price ticks or zero-volume
ticks, and no recapitalization. Both traded within $94.67–$99.88 and finished
at $94.87. This one-minute observation is not a long-horizon market soak.

Verification passed: `scripts/check` (13 JS tests, 43 Rust tests, three explicitly
ignored long/archive tests, formatting/lint/types/build and binding freshness),
`scripts/backend-smoke` (42 tests), `scripts/smoke` (four browser tests against
an isolated local world), and `scripts/upgrade-smoke` (non-destructive old-WASM
upgrade, full-row inverse-migration fingerprints, compact restart/republish,
recovery and persistent timed stop). Overflow fallback, atomic promotion and
post-write failure rollback are exercised. SPEC and frontend source are unchanged.

Evidence:

- [Comparison JSON](../artifacts/performance/compact-actor-storage-20261004/comparison.json)
- [Baseline receipts/host metrics](../artifacts/exploration/20261004T071643Z-1716685/5hz-1000000-normal/normal-1.json)
- [Candidate receipts/host metrics](../artifacts/exploration/20261004T071831Z-1725781/5hz-1000000-normal/normal-1.json)
- [Preserved candidate binaries](../artifacts/builds/compact-actor-storage/README.md)
- [Migration and rollback procedure](../docs/actor-storage.md)

Maincloud was checked read-only: still paused at tick 1374, 1M active actors,
no scheduled ticks. Its earlier run remains FAILED for missed slots; this patch
does not rehabilitate that evidence. No push, merge, deployment, tier change,
production migration or reset was performed. A bounded Maincloud comparison
after explicit paused migration is the next measurement, not a promised 5 Hz win.
