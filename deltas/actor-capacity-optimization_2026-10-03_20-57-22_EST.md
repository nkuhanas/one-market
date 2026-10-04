# Delta: actor-capacity optimizations and pause-test reliability

- Status: implementation in progress; transport extension authorized in draft
  [PR #3](https://github.com/nkuhanas/one-market/pull/3). Not merged.
- Created: 2026-10-03 20:57:22 EST (UTC-05:00, fixed standard time, not EDT).
- Local base: merged `main` at `64de1e6020b0718bf0bf16bc29f202e2b2720a56`.
- Implementation base: upstream `main` revision
  `cbcf1871cf579c339306459267a0baa425138f25`, including the reviewed CI failure
  and newer frontend work, preserved on `perf/actor-capacity-delta`.
- Owner: runtime and benchmark work falls under Chace; public interface changes
  require coordination with Kaleb.
- Authorization: the subsequent user goal requests implementation in a separate
  PR and merge only if clean. The original proposal below remains the acceptance
  plan; Maincloud deployment and changes to the specification remain excluded.

## Objective

Increase the number of persistent actors the existing market can sustain at
20 Hz without weakening the workload, correctness checks, or persistence model.
Every actor must still receive one material database-row update per completed
20-tick epoch, including actors that pass, exit, or cool down.

First make the existing pause regression tests synchronize with authoritative
state, so delayed client updates do not produce false runtime failures.

No capacity increase is promised. The proposed optimizations below are untested;
only new qualification evidence can establish a higher result.

## Measured starting point

The previous optimization replaced variable-width private actor fields with
lossless fixed-width representations. That work is already merged and is the
baseline for this delta, not a proposed change.

- **325,000 actors qualified locally for both NORMAL and CHAOS**, with three
  fresh passing runs per profile. P99 start lateness ranged from 15,616 to
  19,924 microseconds, with zero skipped slots in all six runs.
- **337,500 qualified for NORMAL only.** Two CHAOS confirmations each skipped
  one slot; the first miss occurred before the shock. The cause of those rare
  delays remains unproven.
- **350,000 passed a short NORMAL probe but failed longer probes.** A short
  exploratory pass is not qualified capacity.
- **500,000 still failed.** The fixed-row build achieved approximately
  349–355k committed actor updates per wall second in the retained short probes;
  throughput during failure is not a passing capacity result.

Reference evidence:

- [Capacity worklog](../docs/capacity-worklog.md), including profiling limitations
  and all before/after results.
- [325k six-run archive](../artifacts/baseline/20261003T224614Z-3341112/).
- [337.5k archive, including failed confirmations](../artifacts/baseline/20261003T220900Z-3162127/).
- [Reference fixed-row module](../artifacts/builds/fixed-row.wasm), SHA-256
  `2b3b53fd6f709de7236c600d970805cf35dd80f8c75fd2cb29085048a55dcbcb`.
- Preserved capacity snapshot: tag `capacity/local-325k` at `a363e74`.

These are local Docker results, not Maincloud results or a universal platform
limit. The global clock is 20 Hz; individual actors run once per logical epoch,
approximately once per second when cadence is maintained.

## Proposed changes and order

### 0. Fix the pause-test subscription-cache race

The supplied failure report identifies a test synchronization issue: after
`pauseSimulation` returns and the cached `runtimeConfig.enabled` becomes false,
the test samples `row().logicalTick` from the subscription cache. Previously
committed tick updates can still arrive before the comparison 150 ms later,
making the test report progress even though the server has already paused.

The current [backend tests](../tests/backend.spec.ts) contain this pattern in
`pause and recovery cannot rehabilitate a failed run`. The test named
`late callbacks expose slot gaps; stale generation cannot advance a paused
world` also samples the cached tick immediately after pausing and needs the
same synchronization review. The reported failure has not been independently
reproduced while writing this note; the matching test code has been inspected.

Planned fix:

1. Introduce a reusable test-only pause/snapshot helper. Await the pause reducer,
   then obtain a fresh owner-authorized server snapshot using a read-only query
   path supported by the pinned stack, rather than treating the existing
   subscription cache as the authoritative post-pause baseline.
2. Confirm the authoritative runtime is disabled and has no scheduled tick;
   capture its logical tick, current run ID, generation, and failed run status.
   Wait, with a bounded timeout, for the subscribed market, runtime, schedule,
   and run-record state to agree with the relevant authoritative values.
   Observing `enabled = false` or a stable tick alone is not a cross-table fence.
3. Check that the authoritative tick remains unchanged over the observation
   window and that the synchronized cache agrees. A retained sleep represents
   the window in which forbidden progress is checked, not a cache-drain guess.
4. Reuse the helper in both affected tests. After injecting the stale callback,
   recheck authoritative tick and schedule state before checking the cache.
   Preserve the assertions that recovery resumes progress, records skipped
   slots, and never changes a failed run back to a qualified state.
5. Add regression coverage that exercises delayed/pre-pause update delivery,
   and repeat the real-runtime backend suite. Confirm the helper does not mask
   a genuine post-pause tick advance, a surviving schedule, or an unauthorized
   state change. Keep timeouts bounded and expose useful snapshot/cache values
   on failure without logging tokens.

This is a test-harness correction, not a reason to modify pause semantics,
increase arbitrary sleeps, accept a tick tolerance, skip assertions, or add
automatic retries to hide failures. Prefer an existing authorized query path;
do not introduce a public reducer or expose private runtime tables for testing.
If authoritative reads reveal actual post-pause progress, retain that evidence
and diagnose the runtime separately instead of assuming the reported cache
race explains it.

This issue is separate from the 337.5k qualification misses. Fixing an assertion
race does not invalidate retained failed benchmarks or establish higher capacity.
Keep the test-only change separately reviewable from the performance experiments.

#### Additional CI failure: paused run still appears RUNNING

The second supplied screenshot is backed by
[GitHub Actions run 37169366113, job 111338987434](https://github.com/nkuhanas/one-market/actions/runs/37169366113/job/111338987434).
Read-only inspection of its logs confirmed:

- Revision: `cbcf1871cf579c339306459267a0baa425138f25` on `main`.
- Failed step: `Backend authorization, market, and recovery integration`.
- Failed test: `pause and recovery cannot rehabilitate a failed run`.
- Assertion: `tests/backend.spec.ts:284`, expected `FAILED`, received `RUNNING`
  from `owner.db.runRecord.runId.find(1n)!.status`.
- Result: four backend tests passed, one failed, and seven did not run because
  the suite is serial. Static/binding checks and live browser integration passed.
- The log also warns about deleting a row absent from the client cache. Preserve
  that diagnostic; it does not by itself establish the cause of the failure.

The [test at the failing revision](https://github.com/nkuhanas/one-market/blob/cbcf1871cf579c339306459267a0baa425138f25/tests/backend.spec.ts#L263)
already waits for two successive equal cached tick values before taking its
baseline. That workaround neither establishes an authoritative pause boundary
nor proves `run_record` has caught up. The tick equality assertion passed in
this run; the immediate run-status assertion failed next.

Include this as a distinct regression in the same test-reliability work:

- Reconcile the newer upstream test edits before implementing; do not overwrite
  them with the older local test body or add a second competing wait mechanism.
- Verify the server-side current run is `FAILED` after pause, then use a bounded
  poll for that same run's cached status. Check it remains failed after recovery
  as well; advancing `logicalTick` alone is not proof that every table is current.
- Exercise delayed run-record delivery separately from delayed market-state
  delivery, retaining failure-status, skipped-slot, and schedule assertions.
- If the authoritative run is actually `RUNNING`, investigate the runtime
  transition or wrong-run selection rather than hiding the mismatch with a
  longer wait. If the authoritative state is correct but the cache never
  converges, preserve the failure and investigate subscription handling.
- Require all twelve existing backend scenarios to execute and pass after the
  fix, plus any added regressions. A green rerun alone without a demonstrated
  synchronization fix does not close this issue.

The CI log establishes the observed mismatch, not its root cause. Cross-table
cache propagation is a hypothesis to verify with authoritative reads; no
runtime behavior change is justified solely by these screenshots.

### 1. Establish a deadline-tail diagnostic control

Reproduce the boundary behavior with the unchanged fixed-row build before
attributing rare misses to a particular subsystem. Correlate intended-slot
lateness with host transaction timings, CPU scheduling, memory/page-fault
activity, and persistence work where reliable measurements are available.

Keep diagnostic runs separate from production qualification. Existing
`profile-ticks` builds deliberately refuse qualification. Run no compilation,
full-population audits, or competing capacity probes during measurement.

The purpose is to distinguish recurring per-tick cost from isolated stalls;
neither visible persistence threads nor a missed deadline proves disk latency
or scheduler contention is the cause.

### 2. Experiment A: direct primary-key index

Test an explicit direct index on private `ActorState.actor_id`, using the pinned
SpacetimeDB 2.10.1 stack. Actor IDs currently form a dense sequence starting at
one, making this a candidate for cheaper primary-key lookup/index maintenance.

- Candidate schema annotation: `#[index(direct)]` alongside `#[primary_key]`.
- Keep the existing B-tree index on `bucket` and the indexed due-bucket query.
- Preserve actor IDs, uniqueness, all fields, and every due actor update.
- Keep the explicit actor-ID sort; do not assume index traversal supplies the
  order needed by coverage digests and deterministic activity sampling.
- Verify actual build/runtime support, initialization cost, memory behavior,
  and update performance rather than assuming the index improves capacity.

Expected touchpoint: [actor schema](../crates/spacetime/src/schema.rs).
Regenerate affected bindings through the repository scripts, never by hand.
Assess index migration compatibility explicitly; use a separate named test
database if needed, without resetting or deleting existing worlds.

### 3. Experiment B: allocation-free digest chaining

The current shared `extend_digest` helper returns a fresh 32-byte `Vec<u8>` on
every call, including every due actor step. Test a fixed-size `[u8; 32]` result
and accumulator, converting to the persisted byte-vector representation only
where required by the schema boundary.

- Preserve the exact BLAKE3 chain: previous digest followed by the actor ID's
  little-endian bytes, starting from the same 32 zero bytes.
- Preserve actor order, bucket membership, previous-step checks, and all
  coverage comparisons. Do not replace ordered evidence with aggregate counts.
- Update all affected callers in runtime, population setup, shared evidence
  validation, and exploration code consistently.
- Add old/new equivalence fixtures, including empty and multi-actor sequences,
  representative bucket populations, and boundary integer IDs. Retain tests
  that reject missing or duplicate actor updates.
- Verify persisted digest bytes remain compatible with existing evidence.
  Build hashes will change even when workload semantics do not.

Primary touchpoints: [shared helper](../crates/market-core/src/lib.rs),
[evidence validation](../crates/market-core/src/evidence.rs),
[runtime](../crates/spacetime/src/runtime.rs),
[setup](../crates/spacetime/src/setup.rs), and
[exploration harness](../crates/benchmark/src/explore.rs).

Test this independently of the index change. Pre-sizing order buffers is a
possible subsequent micro-experiment, not part of the initial digest comparison.
Removing an allocation is not yet evidence of a measurable throughput gain.

### 4. Combine only demonstrated improvements

Compare four configurations as warranted: unchanged baseline, index only,
digest only, and both. Retain the separate results so any improvement or
regression can be attributed. Reject neutral or harmful complexity; a useful
outcome may be better headroom at 325k without a newly qualified higher count.

## Deferred work

- **Static/dynamic actor-row split or further compaction:** potentially useful
  for write cost, but extra lookups may erase the benefit. Requires separate
  schema/contract and migration review; do not remove required authoritative
  fields or narrow numeric ranges without a lossless argument.
- **Auction/SIMD changes:** not the first target. The retained fixed-row
  diagnostic sampled roughly 1.465 ms for auction work, versus 10.922 ms for
  actor selection/read/sort and 14.618 ms for settlement/final writes. These are
  sampled diagnostic means, not P99 transaction execution times.
- Frontend redesign/wiring, sharding, external authoritative simulation,
  dependency upgrades, Maincloud deployment, and host-level tuning are outside
  this initial delta.

## Invariants and safety boundaries

Keep [SPEC.md](../SPEC.md) and the frozen [workload](../config/v02.json)
unchanged. Preserve policy, auction and lifecycle behavior, checked arithmetic,
cash/share conservation, reservations, authorization, confirmed reads, retention
bounds, and the public client contract.

Actor updates, settlement, lifecycle changes, and receipts remain atomic in
SpacetimeDB. Do not lower actor cadence, omit PASS/cooldown writes, reduce viewer
or human load, weaken coverage, move the CHAOS shock, hide skipped slots, or
re-anchor deadlines to obtain a passing result.

Preserve old modules, archives, failed runs, and databases. Experiments use fresh
explicitly named worlds. Ordinary publish/restart must retain state and exactly
one tick schedule. No implicit reset, destructive migration, or deployment is
included. The subsequent user goal authorizes this separate PR and merge only
after clean verification.

## Verification and measurement plan

1. Reconcile the implementation branch with the reviewed upstream changes,
   preserving this note and other contributors' work. Record source revision,
   clean/dirty state, exact module and harness hashes,
   generated-binding identity, runtime/image versions, host resources, and the
   complete workload for every compared build.
2. Use Docker-backed `./scripts/check`, `./scripts/backend-smoke`, and
   `./scripts/smoke` after implementation. Cover deterministic equivalence,
   authorization, coverage, conservation, restart persistence, and the single
   scheduler. Select a compatible development database explicitly for smoke.
3. Run matched exploratory probes using `./scripts/explore`: 325k as a control,
   337.5k and 350k around the previous boundary, and the same failing 500k NORMAL
   workload for before/after comparison. Match durations, repetitions, seed,
   viewer load, and offered human load; retain failures and inconclusive runs.
4. Use longer NORMAL/CHAOS probes to select a final candidate. Keep the original
   shock slot; short probes that finish before the shock do not test CHAOS.
5. Qualify the final production build with `POPULATION=<candidate> PROFILE=ALL
./scripts/benchmark`: three fresh NORMAL and three fresh CHAOS runs, each
   with 30 seconds warm-up and 180 seconds measurement, ten viewers using the
   frozen subscription set, five offered human orders/sec, and confirmed reads.
6. Audit the resulting archive with `./scripts/audit-capacity <archive-path>`
   after measurement. Preserve raw receipts, offered-order evidence, readbacks,
   workload/build hashes, health, failures, and conservation results.

Every confirmation must have zero skipped slots, complete actor-update coverage,
zero reducer failures, P99 start lateness strictly below 50,000 microseconds,
fixed offered/viewer load, and no growing schedule debt. A missed slot during
warm-up still invalidates the run. Missing evidence or client disconnects cannot
be relabeled as passes. Never select only successful repeats from a failed set.

Report wall-time committed throughput and start lateness separately from host
execution timing and client delivery/RTT. Record initialization and memory costs
as tradeoffs; a WASM memory snapshot is not total database memory.

## Completion criteria and implementation handoff

- Pause/stale-callback tests use a verified authoritative baseline and bounded
  cache synchronization; delayed delivery is tolerated without tolerating real
  post-pause progress or an incorrect run status. Both reported failure modes
  have regression coverage, and repeated real-runtime checks pass with the
  original failure/recovery and scheduler assertions intact.
- Both experiments have independently recorded results and a keep/reject
  decision, including any combined-build regression.
- Correctness, binding freshness, real-runtime integration, and browser/restart
  checks pass for the retained implementation.
- The final candidate has full audited six-run evidence before any higher
  combined-profile capacity claim. Until then, 325k remains the previously
  qualified baseline, not an inherited qualification for a modified build.
- Update the capacity worklog with exact reproduction commands, evidence paths,
  performance tradeoffs, migration implications, and unresolved limitations.
- Keep implementation changes focused and separately reviewable from this
  planning note. Commit/push/deployment decisions remain separate from creating
  this file.

## Execution record

Implementation began after the documentation-only request was completed and
the user explicitly authorized the separate PR. Final acceptance is pending.

- `ced7bd3` preserves the original pre-implementation delta.
- `eb5dd9e` implements authoritative pause fencing and twelve synchronization
  regressions. `scripts/check` passed, followed by three fresh backend invocations
  passing all 24 tests. The original suite also passed once before changes;
  neither supplied intermittent failure was independently reproduced locally.
- A failed development run is retained: SpacetimeDB 2.10.1 rejects multi-statement
  HTTP SQL. The helper now uses four independent read-only queries, preserves
  integer precision, and rechecks the stopped state after cache convergence and
  throughout observation. It does not claim those four queries are atomic.
- `77e9cac` / `c6bed1c` add diagnostic-only process sampling and receipt-window
  correlation. The unchanged 350k CHAOS 30+90s diagnostic passed with P99
  25,151 microseconds and zero skips. Its 1,131 process samples correlate 2,396
  receipts; this does not reproduce or explain the earlier isolated misses.
- Evidence so far is under `artifacts/verification/20261004-actor-capacity/`,
  `artifacts/profiling/deadlines-20261004T021050Z-102855/`, and
  `artifacts/exploration/20261004T021051Z-103017/`. Two uninstrumented NORMAL
  controls each at 325k, 337.5k, 350k, and 500k are complete. The first three
  populations passed these short probes; both 500k runs failed. These are not
  new qualifications. Direct-index and digest experiments had not started at
  that checkpoint; subsequent progress is recorded below.

### CI escalation: transport ordering, not merely cache delay

Both the push and PR checks for `77e9cac` failed at the new pause fence:
[push run](https://github.com/nkuhanas/one-market/actions/runs/37170309750)
and [PR run](https://github.com/nkuhanas/one-market/actions/runs/37170312051).
Static/binding checks and live-browser integration passed; sixteen backend
tests passed, one failed, and seven serial scenarios could not run.

The authoritative server snapshot was tick 60, disabled, generation 2, run 1
`FAILED`, and zero scheduled ticks. After five seconds the subscription cache
was still tick 60, enabled, generation 1, run 1 `RUNNING`, with one schedule.
The stronger assertions exposed the divergence rather than hiding it.

Inspection of installed SpacetimeDB TypeScript SDK 2.10.1 found asynchronous
decompression is started independently for each WebSocket message before the
SDK's ordered inbound queue. A deterministic diagnostic using the unmodified
adapter/decompressor source and real gzip payloads delivered wire messages
`[1, 2]` to callbacks as `[2, 1]` in ten of ten trials. Uncompressed controls
delivered `[1, 2]` in all ten. Source hashes, reproduction code, and output are
retained in `artifacts/verification/20261004-actor-capacity/` as
`reproduce-sdk-ordering.mjs` and `sdk-ordering-result.txt`.

This proves the adapter ordering defect. It is a strong explanation for the CI
divergence, but CI did not retain raw frame traces, so that causal attribution
is not yet proven. No dependency, application transport, or compression setting
has been changed. The server pause implementation remains unchanged.

Per the request to circle back if the PR is not clean, do not merge this PR.
The scope decision brought back was whether to address ordering in the shared
client transport (with corresponding browser and transport regression coverage)
or explicitly use uncompressed connections only in the backend harness while
leaving the production SDK transport issue documented and unresolved. Neither
choice may bypass authoritative assertions, weaken load, or change qualification
criteria. Runtime optimizations and final six-run qualification remain pending.

### Authorized extension: shared ordered transport

The user replied “extend the pr”, authorizing the shared client fix in this PR.
The implementation uses a small `packages/transport` workspace through the
public SDK `withWSFn` hook for both frontend and backend TypeScript clients.
Raw frames are queued before decoding, retaining gzip, confirmed reads, token
exchange, and the pinned dependencies. Closing cancels pending decoding;
malformed frames close the connection instead of skipping a transaction.
Browser and Node ordering/lifecycle regressions accompany the fix. There are
no visual, runtime pause-semantic, workload, or SPEC changes.

Both CI invocations at `8e52986` passed all 33 backend/transport and three browser
tests, plus static/Rust/build/binding checks. The direct-index candidate has
unchanged bindings and passed all 24 pre-transport backend tests. Its independent
paired short probes passed at 325k/337.5k/350k and failed at 500k, with improved
throughput but no higher qualification. A fresh-world non-destructive migration
preserved all checked rows. Digest-only equivalence/static checks passed;
independent and combined matrices are now complete. The direct index is retained;
the production digest change is rejected as inconclusive (sub-1% paired failure
throughput gain, mixed tails, unchanged passing boundary). Its source, module,
raw measurements and test-only equivalence fixtures are retained. Longer 375k
NORMAL/CHAOS probes are next. The worklog has hashes, results, commands and paths.
The PR remains draft until final qualification and CI have been reviewed.
