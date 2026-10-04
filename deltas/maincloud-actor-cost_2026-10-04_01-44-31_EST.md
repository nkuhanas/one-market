# Migration-free actor cost and Maincloud measurement

Base: `209c7cc` (main, including frontend PR #9). Branch:
`perf/maincloud-actor-cost`. PR #9 changes presentation/local activity handling;
it adds neither subscription queries nor automatic reducer traffic. Preserve it.

## Scope

1. Measure server tick phases with the existing sampled `profile-ticks` build,
   adding a whole-tick timer. These timers measure reducer work, not the later
   transaction commit, replication, queueing or subscriber processing. Compare
   them with receipt start gaps; do not label the residual as pure commit time.
2. Make each actor cheaper without migrating live balances: use exact narrow
   integer division when operands fit, retaining the original wide fallback;
   prepare shared policy inputs once per tick; move final actor rows into the
   database instead of cloning and rescanning the whole batch.

Keep every actor decision, rounding rule, overflow check, deterministic auction,
20-bucket assignment and one persisted update per due actor. No float math,
sampling actors, skipped writes, policy/configuration change or SPEC edit.
Hot/cold table decomposition is deferred: removing existing columns needs an
explicit incremental migration and is not a quick non-destructive deployment.
Keep a candidate only if identical-result tests pass and local measurements do
not show a material regression. Report small or absent speedups honestly.

## Safe continuation and rollout

Add an owner-only bounded continuation entry point: close the paused evidence
segment, preserve its failure/receipts, and atomically start a new non-qualifying
timed segment at the same cadence and logical tick. No reset or fake cadence
change. Reject running worlds, invalid duration/hash/profile and incomplete
workload adoption. Failure rolls back the segment closure and timer together.

Regenerate bindings and test authorization, invalid-call rollback, same-cadence
continuation, retained balances/history, and automatic stopping. Run Docker
check, backend, browser smoke and non-destructive upgrade checks. Freeze the old
WASM for comparison/rollback. Publish with `--delete-data=never` while paused.

On `one-market-100k-20261004-035212` keep 1,000,000 actors, seed 20261003,
5 Hz / 200 ms, and 20 buckets. Archive paused aggregates and small actor samples
before publication (not a full account backup). Verify publication preserves
them. Run one 180-second NORMAL diagnostic continuation with a persisted server
deadline and external fallback pause; no synthetic viewer/human load. Archive
receipts, logs, market health, build hashes and selected cadence. Verify no tick
starts at/after the deadline, schedules are empty and the server tick stays still.
Restore the ordinary non-profiling build while paused after log collection.

This is exploratory production evidence, not a capacity qualification or a
controlled identical-market-state A/B trial. Compare against the previous
669-tick / 180-second run (3.717 effective Hz, 230 skipped slots), noting different
market state, connected clients and diagnostic instrumentation.

## Local results before deployment

- `check` passed, including 20 core + 14 module + 5 harness tests, 13 Node
  tests, lint/types/build, Clippy and generated binding freshness. The same three
  archive/large-model tests remain explicitly ignored.
- Backend integration: 40 passed, including the new same-cadence continuation,
  authorization, rejected-call rollback, retained history and deadline stop.
- Paired fresh 1M / 5 Hz NORMAL probes used three viewers, five offered human
  orders/sec, 5-second warm-up and 30-second measurement. Both passed coverage,
  load and final conservation audit with zero skipped slots. These are short,
  sequential exploratory runs, not a statistically established capacity gain.
- Mean host WASM time: 69.851 -> 64.351 ms/tick (7.9% lower); mean host reducer
  transaction metric: 118.410 -> 112.520 ms (5.0% lower). Policy/coverage/lifecycle
  sampled phase: 23.266 -> 18.647 ms (19.9% lower, nine samples each). Final actor
  settlement/write phase stayed effectively flat, 21.968 -> 21.924 ms. This pass
  reduces CPU work, not stored row width or the number of database updates.
- Raw evidence: `artifacts/exploration/20261004T064640Z-1545343/` (control) and
  `artifacts/exploration/20261004T064814Z-1554443/` (candidate). Same workload hash
  `152de315bf14daeaa7468e2f4125d6c183c98ea9e08d9d77671ea51e12f8823b`.
- Control production WASM: `9e4231ba38fa88b5f5646c6ae73e27d5177b79b7f8050c57a242c8ee6e1a95bf`.
  Candidate normal WASM: `a271baa73792444602106614fe2b8b3e05b25a025edcef1145e874828dae58fc`.
  Candidate profiling WASM: `54c64c6970696efc8eaeeb5f72e203e3b59ec37a76859940c1d0f980de3bc056`.
  Building the profiling candidate via the pinned CLI's `--features profile-ticks`
  and its wasm-opt step produced the same bytes as the measured Cargo build.
- Browser smoke: four passed against an isolated local database, including the
  newly landed frontend, persistence/republication and reconnect. The first
  attempt against the pre-existing default local database was rejected with
  HTTP 403 (different owner); that database and its identity were not replaced.
- Upgrade smoke passed old-world preservation, explicit workload adoption,
  restart/republish and durable 5 Hz deadline stopping. SPEC and all frontend
  source files remain unchanged in this branch.

## Production result — 2026-10-04 06:53–06:57 UTC

Published source `8fca9ff3c9b2eb4f7b765b4e5c711c471b77a254` non-destructively.
Paused aggregate/run rows, manifests and five representative private actor rows
were identical before/after publication. No initialization, reset, cadence
switch, human order or synthetic viewer was issued. Four connected identities
were present throughout the recorded samples, as in the previous observation.

The 180-second diagnostic run was segment 3, at the original 1M population and
seed 20261003, continuing logical tick 669. Deadline: **06:56:36.418142 UTC**.
It stopped automatically at tick **1,374**, observed paused at 06:56:36.822 UTC.
No fallback pause was needed; no tick started at/after the deadline. Both
schedule tables were empty, and subsequent authoritative reads stayed still.

| Production observation    |   Previous |  Candidate |
| ------------------------- | ---------: | ---------: |
| Window                    |      180 s |      180 s |
| Committed ticks           |        669 |        705 |
| Effective Hz              |      3.717 |      3.917 |
| Skipped application slots |        230 |        194 |
| Mean start-to-start gap   | 269.153 ms | 255.336 ms |
| P50 start-to-start gap    | 262.460 ms | 246.764 ms |
| P99 start-to-start gap    | 717.396 ms | 718.140 ms |
| P99 start lateness        | 600.456 ms | 624.647 ms |

Observed throughput increased **5.38%**, with **15.65% fewer skipped slots**.
Tails did not improve; this still fails to sustain 5 Hz. Do not label the result
a qualification or controlled A/B: the candidate continued a later market state,
the earlier run had no diagnostic timers, and host conditions were not isolated.
The workload hash is unchanged; every receipt matches its bucket manifest,
membership digest, contiguous logical tick and expected update count.
The candidate performed **35,250,171 actor updates**, or **195,834/sec**.

### Where the server time goes

Thirty-six rotating-bucket samples from host-backed timers:

| Instrumented phase                         |       Mean |
| ------------------------------------------ | ---------: |
| Indexed actor selection and sorting        |  40.446 ms |
| Coverage, policy and lifecycle preparation |  39.483 ms |
| Auction                                    |   8.044 ms |
| Actor settlement and final writes          |  56.375 ms |
| Whole instrumented tick body               | 144.895 ms |

The body timer starts after initial configuration/market reads and ends before
transaction commit. It includes host calls made inside the reducer; it is not
pure WASM CPU time. Matched sampled receipt intervals averaged 261.243 ms,
leaving **116.348 ms outside the instrumented body** (median 102.413 ms).
That residual includes uninstrumented entry/return, host transaction work,
replication/subscriptions, scheduling/queueing and possibly idle time. We cannot
separate those components with these logs and did not obtain Maincloud's
per-database host transaction/CPU metrics.

Nine long start gaps of 717–804 ms recur roughly every 82 ticks. One is captured
directly by the paired sample: tick 1,031's body was about 143.522 ms, while the
following start gap was 718.140 ms, leaving 574.618 ms outside that span. This
localizes that stall beyond the measured actor loop; it does **not** prove a
snapshot, disk flush, log rotation, throttling or replication cause.

The next performance target is actor row read/write and the host transaction
path, not just more policy micro-optimizations. A carefully migrated hot/cold
layout could reduce rewritten payload; it needs its own preservation tests and
measurement, because added lookups can cancel the gain. Request platform-side
commit/replication/queue traces for the recurring stalls. Holding 5 Hz still
requires roughly 22% less average end-to-end tick time from this observation,
plus tail headroom. No further optimization or cadence experiment was started.

### Market and final state

- All 1,000,000 actors remained active at every recorded aggregate sample and
  at the end; no recovery episodes or recapitalization grants occurred.
- Price ranged **$94.43–$106.70**, ending **$99.25**. Zero penny-floor ticks and
  zero zero-volume ticks in all 705 retained price points.
- Replaced the diagnostic module with the verified ordinary candidate
  `a271baa73792444602106614fe2b8b3e05b25a025edcef1145e874828dae58fc` while paused;
  verified the same aggregate/run/sample rows survived. The run record correctly
  retains the diagnostic build hash it measured, not the later deployed hash.
- Final world: READY, 1M actors, selected 5 Hz, `enabled=false`, zero schedules,
  tick 1,374. Segment 3 remains FAILED/non-qualifying for missed slots. Original
  segment 2 and its receipts remain retained, with its original failure reason.

Raw receipts, timing logs/CSV, baseline receipts, summaries, paired timing
analysis, preservation confirmations and SHA-256 manifest are retained under
[`artifacts/maincloud/20261004-actor-cost/`](../artifacts/maincloud/20261004-actor-cost/).
Private actor/account snapshots and credentials are not committed. Code and
evidence are on local branch `perf/maincloud-actor-cost`; this task did not push
or merge a PR or redeploy Vercel. The latest main frontend remains compatible.
