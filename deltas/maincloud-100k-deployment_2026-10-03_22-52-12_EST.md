# Delta: fresh Maincloud deployment with 100,000 actors

- Created: 2026-10-03 22:52:12 EST (UTC-05:00, fixed standard time).
- Branch: `feat/maincloud-100k-deployment`, based on `main` at `563f0ae`.
- Status: implemented; fresh Rust database and 100k simulation live. The plan
  was committed before implementation and publication.
- Intended fresh database: `one-market-100k-20261004-035212`.
- Server: `https://maincloud.spacetimedb.com`.

## Scope

Publish the existing production Rust module to a fresh Maincloud name with
`--delete-data=never`, initialize exactly 100,000 persistent actors with the
versioned seed, and start a non-qualifying NORMAL simulation. Connect the
frontend to this shared world. Leave the existing JavaScript placeholder and
all local databases unchanged. Do not edit SPEC, market rules, schemas, SDK
versions, or qualification gates.

## Implementation

1. Reuse the authenticated Docker CLI identity without printing/copying its
   token into the repository, frontend, or command-line output. Preserve the
   existing explicit-token deployment option and the local CLI identity.
2. Require explicit server/database/confirmation settings and verify the new
   name is absent before publication. Ordinary updates must remain
   non-destructive. Never publish test-support or profiling builds.
3. Add a bounded, resumable initialization/start command: owner checks,
   500-actor batches, exact population/seed checks, no reset, no duplicate
   run/schedule, and no implicit recovery of an existing paused/failed run.
   Record the published WASM hash; use `qualification=false`.
4. Separate the local database selector from public frontend configuration.
   Honor `VITE_SPACETIMEDB_DATABASE` without redirecting local publish/test
   scripts to the cloud target. Only public connection values enter the web
   build. Set the ignored local environment and restart the frontend.
5. Connect the existing Vercel frontend if its credentials/access are supplied;
   report any access limitation explicitly. No new hosting provider or project.
6. Document commands, safe pause/inspection, authentication, and deployment
   evidence. 100k is the selected live population, not a Maincloud capacity
   qualification. Starting this simulation incurs normal cloud resource usage.

## Verification and merge

- Test configuration isolation, deployment guards and resumable initialization;
  run Docker-backed `check` and `smoke` for configuration/client integration.
- Verify the managed schema, owner access, anonymous control/private-table
  rejection, exact population, advancing ticks and one outstanding schedule.
  Observe market price, activity and deadline evidence without changing policy
  or concealing missed slots. Record the managed runtime version if exposed.
- Use a real browser to verify the connected market, 100k actor display and
  advancing updates; retain a screenshot. Keep frontend design unchanged.
- Preserve databases and evidence. Leave the requested simulation running;
  provide an explicit pause command for resource control.
- Commit focused changes, push the branch/PR, reconcile any new `main` changes,
  and merge the exact tested head only after current-head CI passes. No force
  push or protection bypass. Record results and any remaining limitation below.

## Deployment evidence

- Published 2026-10-04 UTC using the existing authenticated owner and
  `--delete-data=never`. The fresh database identity is
  `c200e95eb69477bcf73f4c84aa7a9828dd8ccd623978bef401244483771e7739`.
  Its host type is `Wasm`, with the expected 21 tables and 19 reducers and no
  test-support reducers. The old `one-market-prod-5okg3` placeholder was not
  overwritten. Managed runtime version was not exposed in response headers;
  the build/CLI/client are pinned to 2.10.1.
- Production WASM SHA-256:
  `c1b23e38e9bcf821f88a2fb06b1fbc5c3659d3fb01c8dc2ba92a074a54f42e9c`.
  No Rust, policy, schema, generated-binding or SPEC changes were needed.
- Initialized 100,000 actors in 200 batches of 500, seed `20261003`. The
  20 bucket manifests total exactly 100,000. Initial cash accounting is
  500,000,000,000 cents; initial share supply is 50,000,000 shares.
- Run 1 is NORMAL, `qualification=false`. The first status sample had
  tick 15, 100,000 active actors, one schedule and zero skipped slots.
  At 04:05:18 UTC tick 702 was RUNNING with the same population and scheduler,
  zero skipped slots, and price 10,019 cents. A subsequent retained window of
  710 price points ranged from 9,941 to 10,053 cents, with trading at every
  point and no one-cent floor hits. This is a startup observation, not a
  capacity qualification or guarantee of long-term market behavior.
- Longer observation did expose missed cadence: tick 2,491 had five skipped
  slots, and tick 3,130 had seven. The evidence remains `FAILED` with reason
  `missed application slots`; the simulation remains enabled, with one
  schedule, 100,000 active actors and ongoing trading. No reset, recovery,
  cadence change or reduction in population was made to hide this. Repeating
  the initialization command preserved run 1 and its single schedule.
- Anonymous queries for private runtime/actor tables were rejected (HTTP 400);
  an invalid, non-mutating population-control probe was rejected with
  `admin authorization required` (HTTP 530). Owner checks passed.
- Ignored local `.env` now points to the fresh world, with all private keys
  preserved. The local frontend connected over Maincloud WebSocket, displayed
  100,000 actors and advancing ticks, and correctly reported no qualified run.
  Browser screenshots are retained locally under `output/playwright/`.
- Vercel access was verified against existing project
  `prj_N0QPToGjIIEVCj03Ca4LKB1WuWUG`, linked to `nkuhanas/one-market`.
  Only the two public connection variables were changed: production and
  this branch's preview. The hosted deployment must be rebuilt and verified
  against the final merged commit; credentials are not in Git or frontend code.
  The branch preview built successfully, but browser access requires Vercel
  SSO. Deployment protection was left intact; the public production domain
  will receive real-browser verification after the CI-gated merge.
- Docker `check` passed, including 9 deployment-helper tests, actual Compose
  local/cloud isolation, lint/typecheck/build, Rust tests (25 passed, one
  archive-only test ignored), formatting, Clippy and binding freshness.
  Docker `smoke` passed restart/republish persistence and all 3 browser tests.
  Its dedicated local 200-actor test world was paused afterward without
  deleting rows. CI additionally runs backend authorization/recovery tests.

## Operations and handoff

The Maincloud simulation is intentionally left running. For inspection or an
explicit pause, export the selected target first:

```sh
export MAINCLOUD_SERVER=https://maincloud.spacetimedb.com
export MAINCLOUD_DATABASE=one-market-100k-20261004-035212
./scripts/maincloud-status
CONFIRM_MAINCLOUD=pause ./scripts/maincloud-status pause
```

Pausing preserves data and stops the simulation scheduler, but does not remove
the database or eliminate storage charges. Recovery is a separate explicit
operation and does not rehabilitate failed benchmark evidence. Do not reset
or resize this live world to run unrelated local checks.
