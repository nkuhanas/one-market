# Maincloud deployment

The Rust module runs directly in Maincloud as WASM. Frontend `VITE_*` values
are public connection settings, not publishing credentials. Never put a token
in a `VITE_*` variable, generated bindings, Git, or a browser build.

## Authenticate and select a fresh name

Use the existing authenticated Docker CLI identity, or supply a private exported
`SPACETIMEDB_TOKEN`. The deployment commands reuse the CLI profile without
logging out or overwriting it; an explicit token uses a temporary profile.
If interactive login is needed, retain the existing local identity separately
before changing it. Do not discard the identity that owns local databases.

The scripts require explicit **exported shell settings**; they do not source
arbitrary shell code from `.env`. Build the pinned tooling images first with
`docker compose --project-directory . -f infra/docker-compose.yml build tools web`.

```sh
export MAINCLOUD_SERVER=https://maincloud.spacetimedb.com
export MAINCLOUD_DATABASE=your-new-unique-rust-database
CONFIRM_MAINCLOUD=publish ./scripts/publish-maincloud
POPULATION=100000 CONFIRM_MAINCLOUD=start ./scripts/initialize-maincloud
./scripts/maincloud-status
```

On hosts where Docker needs elevation, use the README's sudo/UID pattern and
pass the selected server/database/population explicitly through `sudo env`.
Never put a literal token into shell history; use the authenticated CLI profile
or securely supplied environment credentials.

Publication defaults to a fresh-name preflight and always uses
`--delete-data=never`. A pre-existing JavaScript placeholder is not a fresh
database: normal publication does not rerun the Rust `init` reducer. The
initializer requires owner access and existing Rust bootstrap rows, inserts
actors in the configured 500-row batches, and starts NORMAL with
`qualification=false` and the compiled WASM SHA-256. Interrupted setup is
resumable only for the same population/seed. Repeating it on the same running
build does not start another run or schedule. A paused/stalled run is not
implicitly recovered; no command here resets or resizes a world.

For an intentional update to an existing market, use
`MAINCLOUD_PUBLISH_MODE=update CONFIRM_MAINCLOUD=publish ./scripts/publish-maincloud`.
It checks ownership and market bootstrap rows, and still forbids data deletion.
Changed workload rules may stop the scheduler until explicit owner recovery;
see the market-recovery delta. Preserve original run evidence.

The dynamics/revival upgrade has an additive-schema preservation gate:
`./scripts/upgrade-smoke` creates a disposable local world using the archived
old WASM, fingerprints all existing actor/account/order/evidence rows, publishes
with `--delete-data=never`, verifies the workload fence and explicit adoption,
then restarts the local service and rechecks the paused state. It never targets
Maincloud. CI runs this gate after backend integration.

For an authorized live update, capture the paused world's actor/account/run
fingerprints before publication, verify they remain unchanged afterward, and
only then call the owner-only `recover_simulation`. Do not use the fresh-world
initializer to adopt a changed workload. The additive dynamics row is seeded
from the current traded price on explicit adoption. `maincloud-status` reports
both the current configuration hash and the historical run configuration hash;
its `build_hash` remains the original run's build, not proof of the newly
published module. Record the new production WASM SHA-256 separately.

## Connect the frontend

Set these public values in the ignored root `.env` for local Vite/Docker use,
or in the existing Vercel project's build environment for the hosted frontend:

```dotenv
VITE_SPACETIMEDB_HOST=https://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DATABASE=your-new-unique-rust-database
```

Restart Vite/recreate the web container after changing local settings; rebuild
the hosted frontend after changing its build environment. Local
`SPACETIMEDB_DATABASE` remains an independent Docker database selector. Cloud
frontend settings never redirect local publication, initialization or browser
tests. Vite reads the repository-root environment, including when started
through the npm workspace.

For Vercel, use the existing `nkuhanas-projects/one-market` project linked to
this repository, with `apps/web` as its root and `main` as its production branch.
Set only these two public values for production and the intended preview
branch; leave other project settings and environment variables unchanged.
Private `VERCEL_TOKEN` credentials belong only in the ignored local environment,
never in Vite settings or the hosted application. Environment changes require a
new deployment; verify the production domain after the Git integration builds
the merged commit.

The initial 100k deployment uses database `one-market-100k-20261004-035212`.
Its public frontend is `https://www.one-market.tech`; deployment evidence and
the module hash are recorded in
[`deltas/maincloud-100k-deployment_2026-10-03_22-52-12_EST.md`](../deltas/maincloud-100k-deployment_2026-10-03_22-52-12_EST.md).

## Inspect and stop

For a deliberately bounded live session, initialize the selected world while
paused, select its cadence, and use the owner-only
`start_timed_run("NORMAL", module_sha256, 180)` instead of `start_run`.
Initialization must finish before that call; `initialize-maincloud` currently
starts an unbounded session and is not the bounded-session entry point.

To measure an **already-started, paused** world without resetting its actors or
switching cadence, call `continue_timed_run("NORMAL", module_sha256, 180)`.
It closes the previous evidence segment (preserving its failure and receipts),
starts a new non-qualifying segment at the current logical tick and selected
cadence, and arms the same durable stop in one transaction. It rejects running
worlds and leftover schedules. Invalid arguments roll back the entire operation.
It does not adopt changed workload rules; explicit adoption is still required.

The timed reducer atomically starts a non-qualifying run and records a private
one-shot stop at `run.origin + duration_seconds`. Durations are 1–3,600 seconds.
It survives operator disconnect and database restart. The scheduled callback
pauses the world; the tick path also refuses new work at/after the deadline.
An in-flight transaction is allowed to finish, so host stalls can delay the
observable pause. Explicit pause/reset cancels the timer; explicit recovery
cancels it too and is not a timed-session restart. Inspect `timed_run_stop`
with owner credentials before start monitoring, and confirm `enabled=false`,
zero tick/stop schedules and a stable authoritative tick afterward. Keep an
external owner-pause fallback; do not infer stop from the frontend cache alone.

Changing an existing population is destructive and separate from publishing.
Only after explicit approval, pause it, call `reset_market("RESET WORLD")`,
and call bounded `reset_batch` until EMPTY. Configure population/seed, select
cadence while EMPTY, and call `initialize_batch` until READY. Capture evidence
first; benchmark receipts and aggregate snapshots do not back up deleted actor
and human accounts. Never insert an implicit reset into publishing or startup.

```sh
./scripts/maincloud-status
CONFIRM_MAINCLOUD=pause ./scripts/maincloud-status pause
```

Status reports bounded aggregate state, not tokens or the actor database.
Pausing stops this module's scheduler and preserves rows; it marks the run
failed/non-qualifying. It is not the same as pausing the entire database or
eliminating all Maincloud storage/connection charges. Never automatically resume
a deliberately paused run. The user may also control the database through the
Maincloud dashboard.

A live population is not a capacity qualification. Observe ticks, trading,
prices, skipped slots and failure evidence separately. Local 375k results do
not establish cloud capacity; the fixed-workload qualification harness is a
separate, explicitly authorized operation.

`run_status=FAILED` with `failure_reason="missed application slots"` is evidence
of missed cadence, not necessarily a stopped simulation. Check `enabled`,
advancing `logical_tick` and `scheduled_ticks` separately. The initial cloud
run did record missed slots; do not reset it or present its population as a
qualified 20 Hz result.

References: [Maincloud](https://spacetimedb.com/docs/how-to/deploy/maincloud/),
[initialization lifecycle](https://spacetimedb.com/docs/functions/reducers/lifecycle/).
