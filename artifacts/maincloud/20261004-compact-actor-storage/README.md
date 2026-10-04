# Maincloud compact actor storage probe

Authorized deployment and bounded live measurement on 2026-10-04. Code:
`252b5c7e88fc89cda018502d8724b4b480db8c3b`,
[PR #10](https://github.com/nkuhanas/one-market/pull/10) (not merged).
Both code push and PR CI passed, including browser/backend and non-destructive
upgrade tests. No tier upgrade, reset, population/cadence change, SPEC edit,
frontend-source edit, or new synthetic viewer/order load.

## Target and preservation

- Server: `https://maincloud.spacetimedb.com`.
- Database: `one-market-100k-20261004-035212` (historical name; 1M actors).
- Identity: `c200e95eb69477bcf73f4c84aa7a9828dd8ccd623978bef401244483771e7739`.
- World: seed 20261003, 20 actor buckets, selected 5 Hz / 200,000 µs budget.
- Profile WASM: `e3d6299f56716aa8c05b56f9714f849d2ab133270fd6956590943c4b961b1bf2`.
- Restored regular WASM: `b9cd69c6bdf7b3b16529b60ffd9fed0567a7449ac259c725a600b68b88f71f6c`.

Before publishing, scanned all actors bucket-by-bucket, checked unique IDs,
bucket membership, latest required update tick and cash/share conservation,
and fingerprinted their canonical full-width logical fields. Published the
retained profile WASM using `--delete-data=never`, verified unchanged world
tables and no automatic actor conversion, then migrated 2,000 disjoint batches
of 500 (at most four requests in flight) while paused at tick 1374.

The second full-population audit found 1M compact actors / zero wide actors,
identical per-bucket and full-population logical fingerprints, and unchanged
non-actor world tables. Connected-identity count alone was excluded from the
world fingerprint because ordinary public browser connections can change it.
The migration did not advance ticks, change any logical actor field, or alter
workload hashes. Fingerprints prove preservation; they are not a database backup.

The canonical pre/post-migration actor SHA-256 was
`811fc18d45b42f0b83146f0cc422fb1b6b2802b4d3674732372b55d849c1f95f`.
Final post-run immutable-field hash still matches before migration, all IDs and
update coverage pass, and total actor cash/shares remain 5,000,000,000,000 cents
and 500,000,000 shares. All 1M rows still fit the compact representation.
Raw actor/account rows and credentials are not included in these artifacts.

## Three-minute live comparison

Used `continue_timed_run("NORMAL", profile_sha256, 180)` without resetting the
existing world. Run 4 started at 07:33:14.436555 UTC with deadline
07:36:14.436555 UTC, advancing tick 1374 to 2121. The server stopped it without
external pause fallback; no receipt started at or after the deadline. The
regular compact build was then restored using `--delete-data=never`; state
preservation and a final full-population audit passed. Final state is paused,
READY, with no tick/stop schedules. Run status remains FAILED for missed slots.
`run_record.build_hash` identifies the measured profile, not the restored module.

Previous numbers come from the retained
[actor-cost run 3](../20261004-actor-cost/summary.json). Both were 180-second,
1M-actor, selected-5-Hz live probes, not capacity qualifications.

| Metric                               | Previous run 3 | Compact run 4 |
| ------------------------------------ | -------------: | ------------: |
| Completed ticks                      |            705 |           747 |
| Effective Hz (ticks / 180 seconds)   |          3.917 |         4.150 |
| Actor updates                        |     35,250,171 |    37,350,140 |
| Skipped application slots            |            194 |           152 |
| Mean start interval                  |     255.336 ms |    240.886 ms |
| Median start interval                |     246.764 ms |    236.672 ms |
| Start-interval p99                   |     718.140 ms |    274.579 ms |
| Worst start interval                 |     803.540 ms |    942.843 ms |
| Start-lateness p99                   |     624.647 ms |    244.239 ms |
| Gaps at least 400 ms                 |              9 |             5 |
| Successive long-gap spacing          |    82–83 ticks |     146 ticks |
| Mean gap excluding gaps >= 400 ms    |     248.933 ms |    238.076 ms |
| Sampled mean reducer body            |     144.895 ms |    152.105 ms |
| Sampled median outside-body duration |     102.413 ms |     87.044 ms |

This is about 6% higher throughput and 22% fewer missed slots, **not sustained
5 Hz**. The p99 improved partly because fewer than 1% of current intervals were
long gaps; the worst gap actually increased. Subsequent four long gaps were
574–593 ms, compared with 717–804 ms previously. Recurrence changed almost
exactly by the inverse row-size ratio (132/74), consistent with the existing
commit-log/write-volume hypothesis. We do not have managed-host segment or
fsync traces, so this does not establish the cause. Even excluding long gaps,
starts remain about 238 ms apart: eliminating only periodic stalls is insufficient
for a 200 ms budget.

Current phase means (37 samples): selection/sort 43.298 ms, policy/lifecycle
39.528 ms, auction 8.326 ms, and settlement/final actor writes 60.516 ms.
The body got slower, not faster, in this cloud sample. Less time outside the
instrumented body is consistent with lower host-side pressure, but that interval
also includes uninstrumented entry/return, scheduling, queueing and possible idle
time. It is not an isolated commit, CPU, or storage metric. Phase timers include
host database calls inside the reducer. No current phase sample coincided with
a long gap, so paired samples cannot characterize the long-stall tail.

## Health and comparison limits

The observed ACTIVE count stayed at 1M. Price ranged $98.33–$103.37, every tick had matched
volume, and no floor tick, recapitalization or revival grant occurred. This
three-minute observation is not a long-horizon health guarantee.

The runs continued the same evolving world at different logical ages. Public
connected identities were four previously and three to four now; no synthetic
fixed viewer/order workload was applied. Both sides used profiling builds, but
the restored regular build was not remeasured. These are sequential operational
observations, not fresh-state controlled A/B trials. The locally measured 44%
DB byte-traffic reduction is separate evidence; this cloud probe did not measure
host transaction counters, physical disk I/O, or WAL write bandwidth.

## Evidence inventory

- `summary.json`, `receipts.json`, `prices.json`: complete run interval, timing,
  aggregate market health, stop checks, and failed-cadence evidence.
- `analysis.json`: receipt coverage/membership, unchanged workload/manifests,
  public connection counts and phase-to-next-start pairs.
- `comparison.json`: both runs' start distributions and every gap >= 400 ms.
- `tick-profile.jsonl`, `tick-profile.csv`: only this run's timestamp-filtered
  phase logs and their aggregate report; older retained server logs excluded.
- `before-audit.json`, `after-migration-audit.json`, `final-audit.json`: all-actor
  canonical fingerprints, bucket counts, conservation and coverage checks.
- `verify-publish.json`, `migration-complete.json`, `verify-restore.json`:
  non-destructive publication/migration/restoration checkpoints.
- `sha256.json`: digests of the retained machine-readable evidence files.

Keep compatible compact-storage code deployed while compact rows exist. See
[migration/rollback operations](../../../docs/actor-storage.md). Do not silently
resume the paused world or erase either run's failure evidence.
