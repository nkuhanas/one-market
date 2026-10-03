# Contributing

Start with [README.md](README.md) for setup and [SPEC.md](SPEC.md) for product
intent. Use the Docker-backed scripts so local development and CI use the same
toolchain. Keep changes focused and reviewable.

## Workflow

1. Branch from `main`, using names such as `feat/actor-scheduler` or
   `fix/subscription-cleanup`.
2. Make the smallest coherent change. Coordinate public schema changes across
   backend and frontend ownership.
3. Run `./scripts/local-publish` after backend changes. Regenerate and commit
   bindings whenever the module interface changes.
4. Run `./scripts/check`. Run `./scripts/smoke` when changing the runtime, client
   subscriptions, connection lifecycle, or Docker integration.
5. Open a PR describing the resulting behavior and validation. Include a
   screenshot for visible UI changes and call out migration requirements.

Chace owns runtime/backend and Kaleb owns frontend. Both review interface changes.
Do not hand-edit `packages/bindings/src`; use `./scripts/generate-bindings`.
Commit dependency lockfile changes with their manifest changes.

## Conventional Commits

Use `type(scope): description`, with an optional scope. Write a short imperative
description. Use `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `build`,
`perf`, or `style`. Typical scopes are `web`, `runtime`, `bindings`, `bench`,
`infra`, and `repo`.

```text
feat(runtime): add actor buckets
fix(web): clean up market subscriptions
docs: explain local development
ci: check generated bindings
```

Mark breaking changes with `!` and explain them in a `BREAKING CHANGE:` footer.
Use a Conventional Commit title for PRs as well, so squash merges preserve the
convention. Separate unrelated changes into separate commits.

## Checks and boundaries

CI runs formatting, frontend lint/types/build, Rust formatting/tests/Clippy/WASM
build, binding freshness, and real browser and backend integration tests. Add tests for meaningful
behavior or regressions; avoid tests that only mirror implementation details.

Never commit credentials, `.env`, CLI authentication state, or database data.
Publishing and startup preserve local data. Destructive migrations or resets need
an explicit purpose and must not happen automatically.

Keep `SPEC.md` unchanged unless a spec edit is explicitly requested. Version any
workload changes in `config/v02.json` and document them in
`docs/implementation-decisions.md`; new configuration/build hashes need new
qualification evidence. Do not present live population or placeholder values as
measured performance, or implement authoritative actors outside SpacetimeDB.
Run `./scripts/backend-smoke` for market/lifecycle changes. Full qualification is
separate from CI: `./scripts/benchmark` takes about 21 minutes at the default
population and preserves all six runs, including failures.
