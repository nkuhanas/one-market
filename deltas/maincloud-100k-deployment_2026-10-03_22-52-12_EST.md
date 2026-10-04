# Delta: fresh Maincloud deployment with 100,000 actors

- Created: 2026-10-03 22:52:12 EST (UTC-05:00, fixed standard time).
- Branch: `feat/maincloud-100k-deployment`, based on `main` at `563f0ae`.
- Status: planned before implementation and publication.
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
