# One Market

A globally shared synthetic market for humans and persistent autonomous policy
actors. The experiment asks how many actors SpacetimeDB can sustain at a selected
simulation cadence (20 Hz by default). All money is synthetic.

The hosted site is a **read-only static demo**. The live production market is
down due to compute costs. Its illustrative prices, actors, and events are not
live data or benchmark results. Run the real market locally with the quick start
below; fresh local startup defaults to **200 actors**, not one million.

[SPEC.md](SPEC.md) describes the product and intended architecture. The v0.2
backend implements persistent actors, uniform-price clearing, human orders,
lifecycle accounting, CHAOS, and a Rust qualification harness. The frontend
includes price/volume candles, agent and lifecycle feeds, human trading, and
runtime diagnostics for local use, plus the hosted static demo.

## Quick start

Requirements: Git, Bash, and a running Docker engine with Docker Compose v2.24+
or newer. ARM64 and AMD64 are supported. You do not need host Node, Rust, or the
SpacetimeDB CLI. The first run downloads container images and dependencies.

```sh
git clone https://github.com/nkuhanas/one-market.git
cd one-market
./scripts/local-up
```

Open <http://localhost:5173>. Open a second browser window to observe the same
advancing tick. **Ping runtime** confirms a public reducer call.

The 200-actor default is a lightweight starting workload for laptops; Docker's
toolchain downloads/builds still need disk space and memory. Startup preserves
existing worlds rather than resizing them. Use a fresh local database name if
you previously initialized a large world and want the small default.

Production builds use static demo mode by default and open no database
connection. Local `npm run dev` / `scripts/local-up` remain live. Set the public
`VITE_MARKET_MODE=static` before starting Vite to preview the demo locally, or
`VITE_MARKET_MODE=live` when deliberately building a live frontend. This switch
does not publish, reset, start, or stop any database.

```sh
./scripts/local-down       # stop services; retain data and publishing identity
./scripts/local-up         # restart and republish without deleting data
```

Local startup initializes 200 actors and starts a development run. This live
population is not a capacity claim. Qualification uses separate fresh databases;
see [benchmark methodology](docs/benchmark-methodology.md) and the
[backend handoff](docs/backend-handoff.md) for measured evidence and limitations.

New actors start with **$5,000 total**: $2,500 cash plus 25 shares at $100.
Fully liquidated actors recapitalize to $5,000 cash; distress revival includes
retained shares when targeting $5,000 equity. Human entry remains $100,000 cash.
Use a fresh or explicitly reset world for these endowment semantics; publishing
never rewrites old actors. Historical capacity results retain their old hashes.

Private actor rows use a fixed-width schema.
The [lossless compact storage path](docs/actor-storage.md) reduces ordinary row
payloads while preserving full-width fallback. Existing worlds require an
explicit paused migration to use it; publishing alone never rewrites actors.
Existing baseline worlds are deliberately not migrated or deleted. To opt into
a separate local world, set `SPACETIMEDB_DATABASE=one-market-v02-fixed-local`
in your ignored `.env` (or export it) before the development commands. Public
observer/human contracts are unchanged. The historical fixed-row build qualified **325,000 persistent
actors at 20 Hz locally for both NORMAL and CHAOS**, with three passing runs
per profile. The [capacity worklog](docs/capacity-worklog.md) records the evidence,
failed higher candidate, before/after measurements and reproduction commands.
This is not a Maincloud result or a universal platform limit; local startup
still uses 200 actors.

375,000 actors is now the accepted local working baseline, supported by
exploratory runs, not six fresh confirmations. The market-recovery policy is a
new versioned workload; the historical 325k qualification does not qualify it.
See the [recovery delta](deltas/market-recovery_2026-10-03_22-05-19_EST.md) for
bounded liquidation, price discovery, verification, and counterparty limitations.
When publishing new workload rules over an existing world, the scheduler stops
before applying them. Explicit owner `recover_simulation` adopts the rules while
preserving balances and marking the continuation non-qualifying; no reset occurs.

## Development

| Command                       | Purpose                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `./scripts/local-up`          | Build images, install locked dependencies, publish, generate bindings, start Vite |
| `./scripts/local-publish`     | Build and republish the Rust module, then regenerate bindings                     |
| `./scripts/generate-bindings` | Regenerate public TypeScript and private Rust harness bindings                    |
| `./scripts/check`             | Formatting, lint, types, frontend build, Rust checks/build, binding freshness     |
| `./scripts/smoke`             | Start the stack and run Chromium integration tests against a real database        |
| `./scripts/backend-smoke`     | Run real-runtime authorization, trading, lifecycle, and fault-injection tests     |
| `./scripts/benchmark`         | Three NORMAL and three CHAOS runs at 200 actors; about 21 minutes                 |
| `./scripts/local-down`        | Stop services while retaining Docker volumes                                      |

Frontend edits reload through Vite. After editing the Rust schema or reducers,
run `./scripts/local-publish`; backend changes are not automatically watched.
Generated bindings are committed and must be regenerated rather than hand-edited.
Run `backend-smoke` after market or lifecycle changes. `POPULATION=200` and
`PROFILE=ALL` are benchmark defaults; `PROFILE=NORMAL` or `CHAOS` selects one
profile. Each profile still requires all three fresh confirmations.

If Docker requires elevated access on your Linux host, preserve workspace
ownership with `sudo -n env LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) ./scripts/check`
(and the same prefix for other scripts).

The scripts consistently select the local database service and use
`--delete-data=never` for publishing. Normal development does not publish to
Maincloud. Database rows and the CLI publishing identity live in separate named
Docker volumes; no tokens or database files are written into the repository.
Do not remove the identity volume independently of its database volume.

### Configuration

Copy `.env.example` to `.env` to override defaults. Shell environment variables
take precedence. `.env` is ignored by Git.

| Variable                    | Default                 | Purpose                               |
| --------------------------- | ----------------------- | ------------------------------------- |
| `WEB_PORT`                  | `5173`                  | Host frontend port                    |
| `DB_PORT`                   | `3000`                  | Host database port                    |
| `SPACETIMEDB_DATABASE`      | `one-market-v02-local`  | Local database name                   |
| `VITE_SPACETIMEDB_HOST`     | `http://localhost:3000` | Database URL reachable by the browser |
| `VITE_SPACETIMEDB_DATABASE` | Local database selector | Optional frontend-only database name  |
| `COMPOSE_PROJECT_NAME`      | `one-market`            | Namespace for containers and volumes  |

If you change `DB_PORT`, also change `VITE_SPACETIMEDB_HOST` to match it. Database
and web ports bind to loopback by default. `VITE_*` values are public client
configuration; never put credentials in them.
The original scaffold database `one-market-local` is left intact. The v0.2
schema uses its own database instead of silently resetting existing rows.

### Troubleshooting

- **Docker unavailable:** start Docker Desktop or your Docker-compatible engine
  and confirm `docker info` succeeds.
- **Port already allocated:** set unused ports in `.env` and update the browser
  database URL as described above.
- **Disconnected:** check the configured database URL, inspect the database logs,
  and use **Reconnect** once the service is available.
- **Schema migration refused:** publishing preserves data. Resolve compatibility
  deliberately; do not add automatic database deletion to startup.

```sh
docker compose --project-directory . -f infra/docker-compose.yml ps
docker compose --project-directory . -f infra/docker-compose.yml logs db web
```

## Repository and contract

| Location             | Responsibility                                                            |
| -------------------- | ------------------------------------------------------------------------- |
| `apps/web`           | React + TypeScript + Vite frontend                                        |
| `crates/spacetime`   | Authoritative Rust SpacetimeDB module                                     |
| `crates/market-core` | Shared deterministic arithmetic, auction, policy, and evidence validation |
| `crates/benchmark`   | Rust fixed-workload qualification harness                                 |
| `packages/bindings`  | Generated TypeScript client interface                                     |
| `infra`              | Docker images and Compose configuration                                   |
| `scripts`            | Container-backed development and verification commands                    |
| `tests`              | Browser integration checks                                                |

The [client contract](docs/client-contract.md) defines public market/feed tables,
identity-scoped human views, and reducer calls. JavaScript uses `bigint` for
64-bit quantities. Deprecated `tick` and `price` aliases keep the current observer
working. One private absolute-time schedule targets the original 50 ms deadline
grid at the default 20 Hz, or the selected profile's 100/200/250 ms grid at 10/5/4 Hz.
Scheduler-origin and admin guards protect clock/control reducers.
Missed slots, pause, and recovery invalidate qualification; they never erase
failure evidence. Ordinary publication/restart preserves rows and scheduling.

The browser subscribes to the singleton and tears down its connection on unmount.
The smoke check recreates the database container and republishes to verify that
the tick, server signing keys, publishing identity, and single scheduler survive.
Integration tests launch two independent browser contexts, exercise ping, and
verify disconnect/reconnect behavior using real subscriptions and reducers.

Versions: SpacetimeDB server/CLI/Rust module and client SDKs/TypeScript SDK **2.10.1**, Rust
**1.93.0**, Node **24.21.0**, npm workspaces, and committed npm/Cargo lockfiles.
The Docker tooling image installs the pinned Rust toolchain over the official
SpacetimeDB image. Browser tests use Playwright **1.63.0**.

## Working together

Chace owns backend/runtime, Rust, scheduling, benchmarks, and Maincloud. Kaleb
owns frontend, UX, visualization, and Vercel. The generated schema contract is
shared. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and commit rules,
and [AGENTS.md](AGENTS.md) for coding-agent guidance.

Remaining parameter choices are frozen in [config/v02.json](config/v02.json) and
[implementation decisions](docs/implementation-decisions.md). The approved
market-recovery delta updates the corresponding specification rules. Maincloud
publication and qualification require a selected development
database and explicit credentials; they are not part of ordinary local startup.

See [Maincloud deployment](docs/maincloud-deployment.md) for fresh-name
publication, bounded actor initialization, frontend configuration, and safe
inspection/start/stop commands (`scripts/start-prod` and `scripts/stop-prod`).
These require an explicit Maincloud target and action confirmation; see the
deployment guide before running them. The authenticated Docker CLI may be reused without
putting publishing credentials in the frontend environment.

## Cadence profiles

`config/v02.json` defines `20hz` (default), `10hz`, `5hz`, and `4hz`. All use 20 actor
buckets: each actor steps once per 1/2/4/5 target seconds respectively. Economic
durations stay in logical ticks, so they slow down too. Human rate limits and
benchmark measurement windows remain wall-clock based. The frontend reads the
server's cadence and uses actual timestamps for chart minute ranges.

Recorded operating presets are **375k at 20 Hz, 750k at 10 Hz, and 1M at 5 Hz**.
See [operating presets](docs/operating-presets.md) and their machine-readable
[record](config/operating-presets.json) for evidence limits. They are local
starting points, not Maincloud qualification; recording them does not apply
settings, resize a world, or alter the default startup population.

For local, non-qualifying capacity exploration:

```sh
CADENCE=10hz POPULATION=375000 WARMUP_SECONDS=10 MEASUREMENT_SECONDS=30 ./scripts/explore
```

Each invocation creates its own fresh local database. `CADENCE` is also supported
by the qualification scripts; it never changes the existing live world.
At 10 Hz, CHAOS starts at 120 target seconds and lasts 1,200 logical ticks
(120 seconds when cadence holds); use a longer probe to include its aftermath.
At 5 Hz, each actor steps every four target seconds. See the capacity worklog for
the tested populations, windows and workload limits; availability is not qualification.

An owner can switch an existing world with `pause_simulation`,
`set_cadence_profile("10hz")`, then `start_run("NORMAL", module_sha256, false)`.
Selection alone never resumes. Balances, actors, pending orders and logical
ticks survive; old evidence retains its original cadence. A continuation cannot
qualify capacity. For same-profile pause recovery, use `recover_simulation`.
See the [cadence delta](deltas/selectable-cadence-profiles_2026-10-04_00-09-08_EST.md)
for safeguards and measured results.

For a changed compiled workload, `adopt_workload_paused(expected_configuration_hash)`
lets the owner adopt it without resuming, before selecting a cadence. It preserves
actors and historical evidence and requires a later explicit start. Public
`trigger_chaos` needs no admin/trader role; repeated clicks share the active shock,
and activation while paused never advances the simulation. The
[4 Hz/public CHAOS delta](deltas/4hz-public-chaos_2026-10-04_02-43-53_EST.md)
records the production change and its verification, not a new capacity claim.

Publish the additive module before deploying the matching frontend: the new
client subscribes to `cadence_state`, which older modules do not expose. Local
development must likewise point to a database with the matching module. This
branch's tests do not publish to Maincloud or change the hosted frontend.
