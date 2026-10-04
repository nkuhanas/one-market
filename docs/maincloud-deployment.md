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

## Inspect and stop

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

References: [Maincloud](https://spacetimedb.com/docs/how-to/deploy/maincloud/),
[initialization lifecycle](https://spacetimedb.com/docs/functions/reducers/lifecycle/).
