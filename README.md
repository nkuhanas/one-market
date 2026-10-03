# One Market

A globally shared synthetic market for humans and persistent autonomous policy
actors. The experiment asks how many actors SpacetimeDB can sustain at a 20 Hz
simulation cadence. All money is synthetic.

[SPEC.md](SPEC.md) describes the product and intended architecture. This initial
scaffold proves the client/runtime connection: a persistent shared tick, a static
$100 price, zero actors, and a public ping reducer. Trading, actor policies,
CHAOS, and benchmark measurements are not implemented yet.

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

The tick targets 20 Hz; this scaffold does not certify scheduler performance or
claim any sustainable actor capacity.

## Development

| Command                       | Purpose                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `./scripts/local-up`          | Build images, install locked dependencies, publish, generate bindings, start Vite |
| `./scripts/local-publish`     | Build and republish the Rust module, then regenerate bindings                     |
| `./scripts/generate-bindings` | Regenerate TypeScript bindings from the Rust module                               |
| `./scripts/check`             | Formatting, lint, types, frontend build, Rust checks/build, binding freshness     |
| `./scripts/smoke`             | Start the stack and run Chromium integration tests against a real database        |
| `./scripts/local-down`        | Stop services while retaining Docker volumes                                      |

Frontend edits reload through Vite. After editing the Rust schema or reducers,
run `./scripts/local-publish`; backend changes are not automatically watched.
Generated bindings are committed and must be regenerated rather than hand-edited.

The scripts consistently select the local database service and use
`--delete-data=never` for publishing. Normal development does not publish to
Maincloud. Database rows and the CLI publishing identity live in separate named
Docker volumes; no tokens or database files are written into the repository.
Do not remove the identity volume independently of its database volume.

### Configuration

Copy `.env.example` to `.env` to override defaults. Shell environment variables
take precedence. `.env` is ignored by Git.

| Variable                | Default                 | Purpose                               |
| ----------------------- | ----------------------- | ------------------------------------- |
| `WEB_PORT`              | `5173`                  | Host frontend port                    |
| `DB_PORT`               | `3000`                  | Host database port                    |
| `SPACETIMEDB_DATABASE`  | `one-market-local`      | Local database name                   |
| `VITE_SPACETIMEDB_HOST` | `http://localhost:3000` | Database URL reachable by the browser |
| `COMPOSE_PROJECT_NAME`  | `one-market`            | Namespace for containers and volumes  |

If you change `DB_PORT`, also change `VITE_SPACETIMEDB_HOST` to match it. Database
and web ports bind to loopback by default. `VITE_*` values are public client
configuration; never put credentials in them.

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

| Location            | Responsibility                                         |
| ------------------- | ------------------------------------------------------ |
| `apps/web`          | React + TypeScript + Vite frontend                     |
| `crates/spacetime`  | Authoritative Rust SpacetimeDB module                  |
| `crates/benchmark`  | Reserved for the future Rust benchmark harness         |
| `packages/bindings` | Generated TypeScript client interface                  |
| `infra`             | Docker images and Compose configuration                |
| `scripts`           | Container-backed development and verification commands |
| `tests`             | Browser integration checks                             |

The public singleton `market_state` row has `id: u8 = 0`, `tick: u64`,
`price: u64` in cents, and `actor_count: u64`. The SDK exposes 64-bit integers as
JavaScript `bigint`. The row starts at tick 0, price 10,000 cents, and zero actors.
One private interval schedule calls `simulation_tick` every 50 ms. Public
`ping()` succeeds without mutating market state. The tick remains persisted
across restarts; `init` runs only when a database is created.

The browser subscribes to the singleton and tears down its connection on unmount.
The smoke check recreates the database container and republishes to verify that
the tick, server signing keys, publishing identity, and single scheduler survive.
Integration tests launch two independent browser contexts, exercise ping, and
verify disconnect/reconnect behavior using real subscriptions and reducers.

Versions: SpacetimeDB server/CLI/Rust crate/TypeScript SDK **2.10.1**, Rust
**1.93.0**, Node **24.21.0**, npm workspaces, and committed npm/Cargo lockfiles.
The Docker tooling image installs the pinned Rust toolchain over the official
SpacetimeDB image. Browser tests use Playwright **1.63.0**.

## Working together

Chace owns backend/runtime, Rust, scheduling, benchmarks, and Maincloud. Kaleb
owns frontend, UX, visualization, and Vercel. The generated schema contract is
shared. See [CONTRIBUTING.md](CONTRIBUTING.md) for development and commit rules,
and [AGENTS.md](AGENTS.md) for coding-agent guidance.

Before implementing market or benchmark behavior, settle clearing/settlement,
liquidation triggers, the full public contract, and benchmark instrumentation and
workload definitions. The scaffold leaves those decisions open and preserves the
original spec.
