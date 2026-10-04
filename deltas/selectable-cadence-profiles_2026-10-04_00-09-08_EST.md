# Delta: selectable cadence profiles and a measured 10 Hz capacity search

Created: 2026-10-04 00:09:08 EST (fixed UTC−05:00).
Branch: `feat/cadence-profiles-10hz`.
Status: implemented and verified locally; requested capacity probes complete.

## Intent and scope

Make the scheduler consume an explicit, persisted cadence profile instead of a
hard-coded 50 ms interval. Retain 20 Hz as the default, support selecting 10 Hz,
and initially prepare 5 Hz without starting or benchmarking a 5 Hz simulation. Measure the
current dynamics/revival workload at 10 Hz on the local Docker runtime. Do not
change Maincloud, Vercel, the live population, or publish a capacity headline.
The user explicitly approved updating SPEC.md to match this extension. During
implementation the user also requested pausing Maincloud: the existing 100k
database was paused at tick 85,475, with zero schedules, and independently checked
again at that same tick. No publication, reset, resize, or cadence change was
performed there; it must remain paused.

Scope update, 2026-10-04 00:32 EST: the user stopped the 10 Hz capacity search at
the ongoing 812.5k probe and explicitly authorized testing one million actors at
5 Hz instead. This supersedes the original no-5-Hz-run constraint and the planned
longer 10 Hz probes. Pause the interrupted 812.5k world, preserve its partial
evidence with a cancellation note, and run 5 Hz locally with three viewers. Keep
the same frozen production binary and economic policy; no live deployment.

## Clock and workload contract

| Profile                                     | Tick interval | Buckets / ticks per epoch | Target actor step interval |
| ------------------------------------------- | ------------- | ------------------------- | -------------------------- |
| `20hz` (default)                            | 50,000 µs     | 20                        | 1 second                   |
| `10hz`                                      | 100,000 µs    | 20                        | 2 seconds                  |
| `5hz` (subsequently authorized for testing) | 200,000 µs    | 20                        | 4 seconds                  |

The versioned configuration is the profile registry. Derive deadlines, recovery
slot arithmetic, measurement slot counts, lateness/debt gates and result metadata
from the selected profile. NORMAL/CHAOS remain separate **market workload**
profiles, not cadence names. Hash the selected cadence into each workload.

Keep actor membership and exactly one persistent actor update per completed
20-tick epoch unchanged. Economic timers, sentiment/private valuation horizons,
CHAOS trigger/duration, cooldown, revival cohorts and history retention stay in
logical ticks/epochs. Their wall-clock duration therefore scales with cadence.
Human offered-order load, order-rate limits, UI activity rate limits, warm-up and
measurement duration remain wall-clock based. Do not blindly replace constants
whose units are unrelated to scheduler cadence.

## Safe switching and persistence

- An owner-only profile selector refuses changes while scheduling is enabled.
- Select before starting a fresh world, or pause an existing world first.
- A changed cadence closes the old timing/evidence segment without erasing its
  receipts, hashes, origin or failure history. Starting again creates a distinct
  run with a fresh absolute-time origin and a persisted cadence snapshot.
- A continuation keeps actor/human balances, pending orders, logical ticks,
  lifecycle/revival/news state and bucket membership. It is never fresh-world
  qualification evidence. Selecting a profile does not start the simulation.
- Keep at most one scheduled callback, invalidate stale generations, preserve
  skipped-slot evidence on ordinary pause/recovery, and never silently re-anchor
  an active run. Same-profile selection is a no-op.
- Use additive tables/reducers, not destructive changes to existing persisted
  actor/runtime/run layouts. Missing legacy timing metadata means the historical
  default only; old evidence must not be relabeled as 10 Hz.
- Evidence remains bounded; any necessary pruning is explicit, owner-only,
  batched and separate from world reset. Never prune evidence automatically on
  profile selection.

## Consumers and verification

Expose bounded public cadence metadata so frontend labels reflect the server.
Use recorded timestamps for chart minute ranges, including history spanning a
profile change. Keep the existing UI design and actual-elapsed-time rate logic.
Regenerate TypeScript/Rust bindings. Update operational examples and SPEC.

Test deadline arithmetic/overflow, skipped-slot recovery, cadence-specific gates
and full actor coverage, profile-sensitive hashes, authorization, paused switches,
continuation non-qualification, unchanged balances/ticks/history, one scheduler,
restart/republish persistence, and default 20 Hz behavior. Test 5 Hz configuration
and arithmetic first; runtime measurement was subsequently authorized above.
Run Docker-backed `check`, backend integration and `smoke`.

## Measurement plan and reporting boundaries

Use fresh isolated local databases, the production WASM (no profiling feature),
confirmed reads, three viewers with the fixed subscriptions and five wall-clock human orders
per second. Preserve artifact hashes, receipts, per-bucket coverage, load/connection
health and cash/share audits. No other capacity probes run concurrently.

During measurement the user changed the required viewer load from ten to three.
Version the reduced count into the compiled configuration/workload hash, rebuild
both module and harness, and retain the completed ten-viewer 375k/750k probes as
separate evidence. All subsequent capacity claims must identify the three-viewer
load; do not silently compare different loads as a cadence-only speedup.

Start at the accepted historical local working baseline of 375k actors, then
increase at 10 Hz until a reproducible timing/load failure or the configured
population ceiling. Refine the passing/failing bracket and run longer NORMAL and
CHAOS probes at the candidate. Ensure CHAOS windows actually include the fixed
shock and enough recovery time. Report price range/floor residence, matched
volume, active/exiting/cooldown counts, grants, actor-update rate, P99 **start
lateness** and skipped slots. A failed or inconclusive sample remains evidence.

The historical 375k baseline used a different market policy. It is not a current
policy qualification or a Maincloud result. Doubling the interval does not prove
doubling capacity. These exploratory runs do not replace three fresh full
qualification confirmations per market profile, and no six-run qualification is
requested here. Record an observed bracket or a tested ceiling, not an unmeasured
platform maximum. The initial plan left 5 Hz unmeasured; follow the scope update
above for its authorized test. Leave the live 100k world paused and unchanged.

## Results

Implementation verification:

- `check`: formatting, lint, frontend types/build, 12 Node tests, 18 core tests,
  13 module tests, five harness tests, Clippy, WASM build and binding freshness
  passed. Three explicitly ignored archive/large-model tests remain separate.
- Backend integration: 37 tests passed, including 10→20 Hz switching with actor,
  human, pending-order, grant and market-dynamics preservation; independent
  origins, unchanged old receipts, continuation non-qualification and explicit
  evidence pruning. Existing default-20 Hz authorization/recovery tests passed.
- `smoke`: four browser/transport tests passed after a real restart and
  non-destructive republish, verifying a retained clock and single scheduler.
  `check`, all 37 backend tests and all four smoke tests were rerun successfully
  after the viewer-load revision; the rebuilt WASM matches the measured hash.
- `upgrade-smoke`: old 20 Hz WASM → new WASM, explicit policy adoption, 20→10 Hz
  switch, paused database recreation/republish, and anchored 10 Hz recovery passed.
  Fingerprints cover existing actors, accounts and evidence; no reset is used.
- Playwright CLI against a local 200-actor 10 Hz fixture: connected, correct
  server-derived labels, a one-minute range of 601 points (inclusive endpoints),
  keyboard chart controls, checked widths 320/768/1024/1440. Existing 320px
  horizontal overflow (394px document), favicon 404 and development StrictMode
  socket warning remain out of scope. Screenshot: ignored local
  `output/playwright/cadence-10hz-desktop.png`. Test browser and fixture stopped
  before capacity measurement.

Initial ten-viewer production WASM SHA-256:
`4b70e0f5976751739608f1ec5288f2ca8c46ab817c763959fed0734edc237a5e`.
Preserved at `artifacts/builds/cadence-profiles/4b70e0f597675173.wasm`.
The revised three-viewer WASM is
`artifacts/builds/cadence-profiles/8f763839d849afe0.wasm`, SHA-256
`8f763839d849afe0481c2fcfe817aec1c2a6f1a16fd134c9c3eabd2c726b8072`.

Measured outcomes (local exploration, not qualification):

- 10 Hz, three viewers, 10+30s NORMAL: 750k passed (47,139 µs P99 start lateness,
  zero skips, 375,000 actor updates/sec). 875k and 1M failed with 31/79 skips.
  The 812.5k refinement was interrupted at the user's request; its partial
  receipts and cancellation note remain archived. No longer 10 Hz probes ran.
- 5 Hz, three viewers, 30+180s NORMAL: **1,000,000 actors passed**, with 13,255 µs
  P99 start lateness, zero skips, full coverage, 45,000,000 measured updates
  (250,000/sec), maintained offered/viewer load and balanced accounting.
  All one million actors remained active; price $94.43–$105.78, final $105.72,
  no floor/zero-volume ticks or grants. The probe was paused after collection.
- 5 Hz CHAOS and Maincloud capacity were not measured. No qualified result was
  published, no live module/frontend was deployed, and 20 Hz remains the default.
  A final Maincloud status read confirmed tick 85,475, disabled scheduling, zero
  scheduled ticks and all 100k actors retained. All local probe worlds were paused
  at the end of measurement; the later user-requested
  [disk cleanup](../docs/maintenance/2026-10-04-disk-cleanup.md) removed the seven
  archived cadence probes while preserving their evidence and release modules.

See [capacity worklog](../docs/capacity-worklog.md#selectable-cadence-investigation--2026-10-04)
for all archives, including failed/cancelled probes, workload distinctions,
reproduction and the slower per-actor responsiveness at lower cadences.
