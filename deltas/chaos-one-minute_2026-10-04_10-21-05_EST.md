# CHAOS reset and one-minute expiry

Requested: clear the current production CHAOS state quickly, then make future
shocks wear off after one minute. Keep the existing 1M-actor, 4 Hz world running;
do not reset actors, balances, accounts, market history, or the simulation clock.

## Rollout

1. Add an owner-only CHAOS reset, verify it locally, publish without deleting
   data, and clear only the active production shock.
2. Replace the fixed 1,200-tick shock duration with a versioned 60-second
   wall-clock deadline. Expiry must work even while the simulation is paused.
3. Preserve public activation and active-shock click coalescing. Repeated clicks
   must not extend the deadline. Stale scheduled callbacks must not clear newer
   shocks. Keep ordinary simulation scheduling and market state intact.
4. Verify owner authorization, expiry, reset, repeated clicks, paused behavior,
   restart/publication compatibility, and generated bindings. Deploy preserving
   the world and leave production running without a simulation stop timer.

The change supersedes the old cadence-scaled CHAOS duration. Existing benchmark
artifacts retain their old hashes and are not evidence for the new workload.
The user approved updating SPEC.md, including wall-clock expiry while paused.

Production inspection at 15:21:45 UTC found the previous shock already expired:
`chaos_active=false`, tick 4,923, and one active 4 Hz simulation schedule. No
world reset or stop was needed to end that shock. The reset control and duration
change can therefore be deployed together after verification.

## Verification and deployment

- Docker `check` passed: formatting, lint, types, build, 13 JavaScript tests,
  48 Rust tests (three explicitly ignored), Clippy and generated-binding checks.
- All 47 backend integration tests passed, including actual 60-second expiry
  while paused, unchanged actors/ticks, public activation/coalescing, admin-only
  clear, scheduler-only expiry, and immediate reset/retrigger.
- On the user's urgent repeat request, published to
  `one-market-100k-20261004-035212` with `--delete-data=never`. The migration plan
  only added private `chaos_expiry`; no existing table was replaced or deleted.
- Release WASM SHA-256:
  `1ef7510a6086deb7f572ef6bc934d1e34c32990ea4604b3afcfcf27246667d6f`.
  New configuration hash:
  `cce41c6307d80a6f677eec5812e869bd93ead97de413f0028a6b6484a603ff64`.
- At 15:29:14 UTC, owner clear and explicit workload recovery confirmed
  `chaos_active=false`, zero news signal, no shock/stop timer, and one running
  simulation schedule. The existing 1M actors, 4 Hz cadence, run 8 and advancing
  tick 6,697 were preserved. No reset, resize, or new qualification claim.
- Existing run metadata keeps its original build/configuration hashes and failure
  history; its recovery reason records adoption of this non-qualifying workload.
- Full old-world upgrade/restart and browser smoke checks are being completed
  before the source-control handoff. No production shock was triggered for tests.
