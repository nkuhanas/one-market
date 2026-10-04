# One Market

A globally shared synthetic market for humans and persistent autonomous policy
actors. The experiment asks how many actors SpacetimeDB can sustain at a 20 Hz
simulation cadence. All money is synthetic.

[SPEC.md](SPEC.md) describes the product and intended architecture. The v0.2
backend implements persistent actors, uniform-price clearing, human orders,
lifecycle accounting, CHAOS, and a Rust qualification harness. The frontend is
still Kaleb's minimal shared-clock observer; the new typed contracts are ready
for its market controls and visualization.

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

```sh
./scripts/local-down       # stop services; retain data and publishing identity
./scripts/local-up         # restart and republish without deleting data
```

Local startup initializes 200 actors and starts a development run. This live
population is not a capacity claim. Qualification uses separate fresh databases;
see [benchmark methodology](docs/benchmark-methodology.md) and the
[backend handoff](docs/backend-handoff.md) for measured evidence and limitations.

Private actor rows use a fixed-width schema.
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
grid. Scheduler-origin and admin guards protect clock/control reducers.
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
inspection/pause commands. The authenticated Docker CLI may be reused without
putting publishing credentials in the frontend environment.
