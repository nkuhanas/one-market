# Maincloud 1M / 5 Hz bounded run

Requested: merge the local cadence/preset changes through a checked PR, deploy
Maincloud with 1,000,000 actors at 5 Hz, run for 180 seconds, and leave it stopped.

## Safety and scope

- Release branch: `feat/maincloud-1m-5hz-timed-run`, based on the existing local
  cadence branch. Preserve all committed measurements and the corrected 750k /
  10 Hz preset. Fetch main, inspect the diff, run checks and merge only the exact
  checked PR head without bypassing required checks or reviews.
- Publishing always uses `--delete-data=never`. Changing the old 100k population
  requires a separate explicit reset. The user explicitly chose **reset the
  existing database**, `one-market-100k-20261004-035212`, including its actors and
  human accounts. Keep the same frontend target; do not create a replacement
  database or change its public name. Capture aggregate/run evidence before
  reset and report that this is not a full actor/account backup.
- No new qualification claim or six-run benchmark. This is one bounded live
  NORMAL observation, with cadence/market health and missed slots reported.
- Keep SPEC unchanged. No market policy, endowment, actor bucket, or workload
  configuration change is needed for this deployment.

## Durable stop before start

Add an owner-authorized `start_timed_run(profile, build_hash, duration_seconds)`
that starts a non-qualifying run and arms its deadline atomically. Accept only
1–3,600 seconds. The deadline is relative to the run's persisted origin, not
completion of initialization, and must survive client disconnects and server
restart. Existing unbounded starts retain their current behavior.

Use an additive private one-shot scheduled table, scoped to the run and scheduler
generation. A scheduler-only callback pauses without resetting rows. Each tick
also checks the persisted deadline before doing market work, so callback ordering
cannot admit new ticks after the deadline. An already-executing transaction is
not interrupted; the stop commits when the server can process it. Wall time,
rather than completed tick count, controls this bounded run even under slowdown.

Explicit pause/reset cancels its timer; explicit recovery does not accidentally
carry a stale timer into another run. Scheduled stale generations cannot stop a
new run. Stop invalidates qualification and retains earlier failures/evidence.
Monitor externally and confirm `enabled=false`, no tick/stop schedules, and an
unchanged server-read tick after the deadline; use owner pause as a fallback.

## Verification and rollout

Regenerate public TypeScript and private Rust bindings. Test authorization,
invalid durations/rollback, atomic arming, actual 5 Hz automatic stopping,
early-pause cancellation, stale callbacks, and persistence across a local
restart. Run Docker-backed check, backend integration, smoke and upgrade checks.

After the checked PR is merged, publish the exact production WASM, initialize
actors in bounded batches while paused, select 5 Hz, verify population and
schedules, then start the timed run. Coordinate any frontend target change with
the user's world-preservation choice; publish the additive schema before its
matching frontend connects. Record target identity, module/commit hashes,
deadline, final state, observed market behavior and limitations without secrets.

## Local verification before PR

- Docker-backed `check` passed: format/lint/types/build, 13 Node tests, 18 core
  tests, 14 module tests, five harness tests, Clippy and binding freshness.
  Three archive/large-model tests remain explicitly ignored, not claimed run.
- Backend integration: 39 passed, including timed-start authorization, duration
  rejection/rollback, 5 Hz deadline stop, schedule cleanup and cancellation.
- Browser smoke: four passed after recreation and non-destructive publication.
- Upgrade smoke: old-world preservation and explicit cadence adoption passed;
  a separate 20-second 5 Hz timer survived live server recreation/republish and
  stopped without an external pause. No receipt started at/after its deadline.
- The old Maincloud world was read-only archived while paused at tick 85,475.
  No Maincloud publishing/reset/start occurred during local verification.
