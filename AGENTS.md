# Repository guidance

Read `README.md`, `CONTRIBUTING.md`, and `SPEC.md` before substantive changes.
Follow the user's current instructions. Leave `SPEC.md` unchanged unless the user
explicitly requests a spec edit.

## Architecture and ownership

- `apps/web`: React/TypeScript/Vite; Kaleb owns frontend, UX, and visualization.
- `crates/spacetime`: authoritative Rust SpacetimeDB module; Chace owns runtime,
  scheduling, policies, and persistence.
- `crates/benchmark`: reserved for Chace's future Rust benchmark harness.
- `packages/bindings`: shared integration boundary; generated TypeScript code.
- `infra`, `scripts`, and `tests`: Docker development and verification.

There is no conventional REST backend. Persist authoritative simulation state in
SpacetimeDB. The scaffold exposes a shared clock and ping; it does not implement
trading, actors, liquidation, CHAOS, or benchmarking. Do not invent missing market
or benchmark rules while completing unrelated work. Never claim unmeasured actor
capacity.

## Development

Use Docker-backed scripts; host Node, Rust, and SpacetimeDB are not required.

```sh
./scripts/local-up
./scripts/local-publish
./scripts/generate-bindings
./scripts/check
./scripts/smoke
./scripts/local-down
```

- `local-publish` rebuilds the backend and regenerates bindings.
- Never edit `packages/bindings/src` manually. Commit regenerated bindings with
  interface changes and update frontend consumers together.
- Run `check` for code/configuration changes. Run `smoke` for runtime, client
  lifecycle, or Docker integration changes. Report checks run and any limitations.
- Keep SpacetimeDB runtime, CLI, Rust crate, and client SDK versions aligned.
- Use npm workspaces and Cargo; preserve committed lockfiles.
- Preserve existing database rows on ordinary publishing and restart. Do not add
  implicit resets, auto-delete migrations, or duplicate tick schedules.
- Treat client environment variables as public. Never commit secrets, local CLI
  identities, or database contents.

## Changes and commits

Make focused changes, follow existing patterns, and avoid unrelated rewrites.
Use Conventional Commits as described in `CONTRIBUTING.md`, for example
`feat(runtime): add actor buckets` or `docs: clarify setup`. Keep PR descriptions
focused on the final behavior and meaningful verification. Do not push or deploy
unless the user's requested scope includes it.
