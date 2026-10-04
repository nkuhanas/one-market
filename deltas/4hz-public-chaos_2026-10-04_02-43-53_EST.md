# Paused 4 Hz production selection and public CHAOS

Status: merged in PR #12 and deployed; see the actor-endowment rollout below. Branch `fix/4hz-public-chaos`, based on
the deployed compact-storage patch and its recorded evidence (`61f1392`).

## Requested behavior

- Add a selectable `4hz` cadence (250,000 µs, unchanged 20 buckets). Keep the
  20 Hz default and existing 20/10/5 Hz profiles and operating presets. Selecting
  4 Hz for the existing 1M Maincloud world must not start or advance the simulation.
  This is an operating setting, not a measured capacity claim.
- Allow any ordinary connected identity to call `trigger_chaos` without admin
  authorization or entering the market first. Keep every other administrative
  permission and private-table boundary unchanged.
- Keep one shock active at a time. Repeat/concurrent clicks succeed without
  creating another event or extending its end tick. A new shock invalidates
  any current qualification segment and immediately publishes its active flag.
  While paused, the shock is staged; actors react only when explicitly resumed.
- Retain the existing button, busy/disconnected/active disabling, and accessible
  success/error feedback. No redesign or frontend branch merge.

## Deployment safety

Adding a profile changes the versioned configuration hash. Existing
`recover_simulation` adopts that hash **and starts ticks**, so it cannot be used
for this request. Add owner-only `adopt_workload_paused(expected_configuration_hash)`:
reject running/not-ready worlds, any tick/stop schedule, and an unexpected hash;
adopt while remaining paused, close the old evidence segment without rewriting
its hashes/receipts/failure history, and require a later explicit non-qualifying
start. Same-hash adoption is idempotent. It never resets actors or financial state.

Publish with `--delete-data=never`, retain compact-row compatibility, explicitly
adopt the expected config while paused, then select `4hz`. Verify the unchanged
authoritative tick, all-actor fingerprints/accounting, historical evidence, zero
tick/stop schedules, and the public cadence. Do not start a Maincloud benchmark,
trigger a production shock for testing, reset data, or change the hosting tier.
Verify public CHAOS using an isolated local database and browser, not production.

## Verification

- Registry arithmetic and server-derived 4 Hz label tests.
- Real-runtime tests for 4 Hz deadlines, authorization, safe paused adoption,
  stale/wrong-hash rejection, immutable historical evidence, and unchanged actors.
- Public CHAOS from a non-trader identity, cross-client visibility, idempotent
  repeated calls, expiry/retrigger, retained admin guards, and no resume on click.
- Docker `check`, `backend-smoke`, `smoke`, and non-destructive `upgrade-smoke`.
- Record published module/source/config hashes and paused production results.

The user explicitly approved updating SPEC.md for 4 Hz and public CHAOS. Retain
historical qualification evidence under its original cadence/access rules.

## Local verification and production hold

Docker `check` passed (13 JS tests, 43 Rust tests, three explicitly ignored,
lint/types/build/format/Clippy and both generated binding sets). `backend-smoke`
passed all 46 tests, including 4 Hz absolute deadlines, paused adoption,
all-actor preservation, anonymous non-trader CHAOS, concurrent idempotence,
logical expiry/retrigger, and retained admin denials. Browser `smoke` passed
four tests; the old-WASM upgrade/restart/compact-storage/timed-stop gate passed.

An additional Docker Playwright CLI session activated CHAOS using Tab/Enter
from a fresh ordinary browser, without entering the market. It showed the
shared shock, disabled the already-active button, and announced success in the
existing live region. Authoritative LOCAL tick 1276 remained unchanged and
`enabled=false`. The skill-guided change preserves semantic button controls,
busy/error feedback and the existing design. The browser had the existing
favicon 404/development Strict Mode socket warning; a 320px header overflow is
pre-existing and outside this focused control change.

Production was inspected read-only: paused at tick 2121, 1M compact actors,
no tick/stop schedules; complete actor-ID/coverage/cash/share audit passed.
No production publish, resume, shock, reset or balance change has occurred.

The user subsequently requested $5k per actor and a safe branch/push/merge.
Production rollout and final merge are held until the $5k cash-vs-total-equity
definition and existing-world migration-vs-reset choice are resolved. Human
bankrolls must remain unchanged: actor recapitalization and human entry currently
share `bankroll_cents`, which must be separated for an actor-only reduction.

The user has now resolved both choices: $2,500 cash plus 25 shares ($5,000 total),
$5,000 actor recapitalization target, unchanged humans, and an explicit reset of
the existing production world without resuming. The
[actor-endowment delta](actor-endowment-5k_2026-10-04_09-18-33_EST.md) supersedes
this document's no-reset/adopt-existing-actors rollout; paused adoption remains
available for future compatible changes. Production still must not tick.

PR #12 merged as `9d90267e794803bb9c5ee6d675019fce15fd30af` after both CI
checks passed. The regular module was published with `--delete-data=never`;
the separately authorized reset and fresh $5k initialization selected 4 Hz
without starting ticks. The user then explicitly authorized one three-minute
timed run after initialization, superseding the earlier no-resume instruction
for that session only. See the
[deployment evidence](../artifacts/maincloud/20261004-5k-4hz/README.md) for the
final state and limits; no other admin authorization was relaxed.
