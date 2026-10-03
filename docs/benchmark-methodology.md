# Benchmark methodology

Qualification measures schedule adherence and committed actor updates, not
a universal capacity ceiling or host execution duration. The original 200-actor
baseline was not a capacity search. All money and orders are synthetic.
Workload constants live in `config/v02.json`; hashing and frozen phases are
documented in [implementation decisions](implementation-decisions.md).

## Run locally

```sh
# On the fixed-row branch, use a separate world from the old baseline schema.
export SPACETIMEDB_DATABASE=one-market-v02-fixed-local
./scripts/local-up
./scripts/check
./scripts/backend-smoke
./scripts/smoke
./scripts/benchmark
```

Run smoke before benchmarking: it intentionally recreates the database server.
If Docker requires `sudo`, pass `SPACETIMEDB_DATABASE` through `sudo env` together
with `LOCAL_UID` and `LOCAL_GID`, or put it in the ignored `.env`; do not assume
`sudo` preserves the exported database selection.
Avoid server restarts, module publication, or builds during measured runs.
`POPULATION=200 PROFILE=ALL` is the default. A complete invocation takes about
21 minutes plus setup. Each profile gets a new named local database, and each
of its three repeats gets a fresh actor world and human identity. The harness
refuses a preexisting nonempty world at entry. Between its own repeats it uses
explicit bounded resets; normal development databases are untouched.

All module and harness builds are release builds. Initialization inserts at most
500 actors per transaction and finishes before any scheduled tick. There is no
per-actor subscription, log, or full-population scan in measured ticks. Due rows
come from the bucket index. The settlement engine sorts order events and sweeps
cumulative quantities in O(K log K), with real counterparties and no synthetic
liquidity. Each due actor gets one final persistent update in every lifecycle
state. Full cash/share conservation audits run only after measurement stops.

## Fixed load and timeline

Each repeat uses 30 seconds warm-up, then 180 seconds measurement: 4,200 intended
50 ms slots, including 3,600 measured ticks. Ten ordinary viewer connections
maintain the six production queries in the client contract throughout the run.
One additional ordinary human identity offers one-share orders every 200 ms on
a fixed wall-clock schedule (1,050 attempts total), alternating BUY at 10,100
cents and SELL at 9,900. The generator does not wait for acknowledgments to offer
the next order and does not adapt to price, fills, rate rejections, or overload.
An offered order may legitimately be rejected; attempts, acceptance, reasons,
and per-call round-trip timing are preserved. More than 50 ms of generator
lateness invalidates the fixed-load gate.
Expected human validation rejections are recorded workload outcomes, not failed
scheduled simulation transactions. Transport errors or lost connections are not
silently counted as successful offers.

NORMAL and CHAOS share population, seed, policies, queries, human script and
timing. CHAOS alone inserts the versioned negative shock at intended slot 1,200,
lasting 1,200 logical ticks with 8,000 bps severity and 10,000 bps confidence.
Neither profile guarantees a crash or a liquid market. Without actual buyers,
price freezes and exits remain incomplete.

The intended deadline is `origin + slot * 50,000 us`, assigned before invocation.
No callback re-anchors the grid. A late callback executes one tick and records
skipped following slots; it does not silently catch up. Failed transactional ticks
do not commit receipts or reschedule; a timeout is visible and recovery requires
an administrator. Pause, manual stepping, late slots, and recovery cannot turn a
failed run back into a qualified one.

## Evidence and gates

The same transaction commits actor final rows, settlements, counters, and a
receipt containing run/slot/logical tick, intended/invoked timestamp, lateness,
skips/debt, bucket, actor steps/updates, ordered membership digest, previous-step
validity, policy evaluations, orders, and matched volume. Runtime checks compare
the indexed due set to the initialization manifest and check every actor's prior
step. The harness independently derives the expected bucket membership and
validates all retained receipts. Aggregate update counts alone are insufficient.

A confirmation passes only with complete coverage, zero skipped slots, no
established reducer failure, fixed offered/viewer load, healthy confirmed-read
connections, no growing debt, and measured P99 start lateness strictly below
50,000 us. At population 200, a successful measured window contains exactly
36,000 actor updates (200 per epoch for 180 epochs). Three fresh PASSED runs with
matching population/seed/profile/build are required before publication.
Debt is invocation lateness against the original grid, never a re-anchored clock.
The validator also compares the mean debt of the first and last 20 measured
ticks; growth of more than one 50 ms slot fails. Any individual skipped slot
already fails independently, including during warm-up.

Missing evidence or a disconnected collector is INCONCLUSIVE unless another
established violation already makes the run FAILED. Duplicate/wrong membership,
logical/slot mismatch, skipped workload, or reducer failure is FAILED. Recovery
does not erase failure. The server independently validates private receipts;
only an admin may attest external load/connection evidence and publish a summary.
This is an authorized evidence workflow, not a cryptographic proof against a
malicious database owner.

## Artifact interpretation

`artifacts/baseline/<timestamp-pid>/<profile>/` contains:

- `workload.json`: exact compiled configuration bytes.
- `<profile>-1.json` through `-3.json`: complete receipts, offer outcomes,
  receipt arrival timestamps, connection/load/accounting status, validation,
  database/environment, runtime/toolchain/image/binding/lockfile metadata and
  workload/release-WASM hashes.
- Matching CSVs: receipt-level timing and workload counters for plotting.
- `summary.json`: all three run IDs and JSON BLAKE3 hashes; `PASSED` or
  `NOT_QUALIFIED`, never best-run cherry-picking.

Public `BenchmarkResult.evidence_hash` is BLAKE3 of the exact summary bytes. Each
summary links the three exact artifact-byte hashes. Its P99 is the worst of the
three per-run P99s, and its update count sums all three measurement windows.
Detailed runtime retention is six runs and 8,192 receipts/run; external artifacts
remain necessary after retention expires. Keep JSON bytes intact when archiving.

Receipt arrival and reducer RTT are client timings, not execution timers.
`invoked_at - intended_at` is server start lateness. Client/server timestamp
subtraction includes clock skew; local containers share the host clock. Before a
remote trial, synchronize clocks and record their uncertainty. The current
remote generator aligns from the server origin using the client wall clock, so
unbounded skew would invalidate timeline comparison. CPU allocation/model and
kernel are recorded; energy, exclusive-core isolation and validated host
P99 execution duration are unavailable and are not claimed. The capacity
investigation additionally retains aggregate host transaction metrics, sampled
host-backed phase timers, and native CPU profiles. These diagnostic measurements
are distinct from the start-lateness qualification gate.

## Exploration, comparison, and artifact audit

`./scripts/explore` runs explicitly non-qualifying local probes. Defaults are
5 seconds warm-up and 20 seconds measurement, with the same ten viewers and
five offered human orders/second. `WARMUP_SECONDS`, `MEASUREMENT_SECONDS`, and
`REPEATS` control probes only; production qualification remains 30+180 seconds
and three fresh confirmations. Short-run success is `EXPLORE_PASS`, never a
public qualified result. Preserve failed probes as well as passes.

For CHAOS, use a long enough probe to reach the unchanged shock at slot 1,200;
the investigation uses `WARMUP_SECONDS=30 MEASUREMENT_SECONDS=90`. Never move
the shock earlier to make a short run look representative. Probe throughput
counts confirmed committed receipts in a fixed server-invocation timestamp
window and divides by actual window seconds, not by completed ticks. This is
not an exact commit-completion timestamp measurement. Receipt CSVs, explicit
window lengths, reasons, initialization duration, and module/workload hashes
are retained under `artifacts/exploration/`.

`MODULE_WASM=artifacts/builds/baseline-v02.wasm ./scripts/explore` selects the
preserved original binary. The script regenerates an isolated private Rust
decoder for the selected schema; normal production bindings remain untouched.
`PROFILE_TICKS=1` selects a separate diagnostic release build which rejects
qualification. `scripts/profile-native` optionally uses Linux host `perf` and
timestamps a capture within offered load, excluding setup and post-run audits.
See [capacity worklog](capacity-worklog.md) for results, limitations, and commands.

After all six full runs stop, execute `./scripts/audit-capacity <archive-folder>`.
It reads back the public results and retained server validation/run/news rows,
then checks artifact and summary hashes, exact configuration bytes, raw receipt
coverage/deadline/debt gates, actual offered load, CSV parity and wall-window
rates. The check is separate from live collection and cannot qualify a failed
or exploratory archive. It does not mutate the database. Run it only after
measurement because it compiles its read-only test verifier.

## Maincloud: explicit, bounded, separate

No Maincloud qualification has been performed. It requires a selected development
database, authorization, and credentials; no credentials were provided. Never
point the harness at a shared world. Use separate empty development databases
for NORMAL and CHAOS. Supply secrets through the environment, not tracked files:

```sh
# Set MAINCLOUD_SERVER, MAINCLOUD_DATABASE and SPACETIMEDB_TOKEN securely first.
CONFIRM_MAINCLOUD=publish ./scripts/publish-maincloud
CONFIRM_MAINCLOUD=benchmark PROFILE=NORMAL POPULATION=200 ./scripts/benchmark-maincloud
```

Publication preserves rows (`--delete-data=never`) and uses only a temporary
container identity. Benchmarking does not publish the module and refuses an
already initialized world. It runs exactly three 210-second windows, never a
capacity search. Record the observed managed runtime build in
`OBSERVED_RUNTIME_VERSION` when exposed, otherwise artifacts label it unavailable.
Repeat the compatibility/authorization gate on that managed stack before making
any deployed claim. LOCAL results do not stand in for Maincloud results.
