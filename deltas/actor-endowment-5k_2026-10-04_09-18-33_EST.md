# $5k total actor endowment and explicit paused production reset

Status: implemented and locally verified; production rollout pending. Extends `fix/4hz-public-chaos` and
the paused 4 Hz/public CHAOS delta. Timestamp uses fixed EST (UTC−05:00).

## Semantics

- New actors receive 250,000 cents cash plus 25 shares at the 10,000-cent
  starting price: 500,000 cents ($5,000) total, split 50/50 cash/equity.
- Separate actor and human bankroll configuration. Humans still receive
  10,000,000 cents ($100,000), with unchanged human P&L and entry accounting.
- Fully liquidated actors enter cooldown with zero shares; after the existing
  20-tick cooldown, grant `max(0, 500000 - cash_cents)`. Do not remove excess
  cash, mint shares, or count grants as lifetime profit.
- Inventory-retaining distress revival targets $5,000 total marked equity,
  not $5,000 additional cash. Reduce the per-actor lifetime revival cap to
  $5,000; existing 25% episode/100% world budgets derive from the new initial
  actor bankroll. Preserve cohort timing, liquidation rules and budget limits.
- Initial share supply is exactly `25 * actor_count`. Initial endowment,
  per-life peak, grants, lifetime P&L and conservation all use clean new rows.

## Authorized rollout and reset

The user explicitly requests a reset, not migration of old actors, and permits
updating production while leaving it paused. The actual existing world has
1,000,000 actors; retain that population and seed 20261003. The database name
`one-market-100k-20261004-035212` is historical, not its population.

Verify and safely merge the code through PRs, accounting for any independently
landed frontend changes. Publish the regular module with `--delete-data=never`.
Then explicitly call owner-only `reset_market("RESET WORLD")` and bounded
`reset_batch`, select `4hz`, and initialize in bounded 500-actor batches.
Never call the normal initialize-and-start helper, `start_run`, recovery that
resumes, or a production CHAOS trigger. Retain zero tick/stop schedules.

This deletes current actors, human accounts/orders and world presentation/
recovery history, not the historical benchmark artifacts. Preserve retained
run evidence and order-ID watermarks according to the existing reset contract;
archive control/evidence hashes and aggregate totals before reset. An audit is
not a full database backup. No old capacity qualification transfers to this
new economic workload, and 4 Hz is an operating setting, not a measured claim.

## Verification

- Unit tests for exact initial allocation, separate human bankroll, zero/
  partial/full recap grants, no duplicate grants, grant-adjusted lifetime P&L,
  retained-inventory revival and all budget caps.
- Real-runtime tests for clean initialization/accounting, unchanged human
  entry, recapitalization and explicit reset across both physical actor stores.
- Docker `check`, `backend-smoke`, browser `smoke`, and `upgrade-smoke`.
- Production audit: READY but disabled, tick 0, $100 price, 1M unique ACTIVE
  actors with the exact new balances/peaks/endowments and zero grants/P&L;
  25,000,000 total shares and 250,000,000,000 initial cash cents; 4 Hz public
  cadence; no scheduled ticks or timed stop; retained old evidence untouched.
- Verify hosted frontend deployment and record source/config/module hashes.

SPEC's economics and operational documentation will match these explicit user
instructions. Historical evidence retains its original configuration/build.

## Implementation and local results

Actor and human targets are now explicit separate configuration fields. Both
human P&L paths continue to subtract the unchanged human entry grant. Actor
cooldown/revival use only the new actor target; initialization derives equity
and accounting from the new cash/shares without any migration or share minting.

Docker `check` passed: 13 JavaScript tests, 46 Rust tests (three explicitly
ignored exploratory tests), format/lint/types/build/Clippy and generated-binding
freshness. `backend-smoke` passed all 46 tests, browser `smoke` passed all four,
and the non-destructive old-WASM upgrade/restart/compact-storage/timed-stop gate
passed. Two model assertions were updated to recognize actual completed
liquidation before an actor's revival cohort: all actors still must escape the
original EXITING state, and conservation/grant accounting remain audited.

The independently verified performance PR #10 merged first as `f1ff0e8`.
Read-only production preflight confirmed 1M compact actors, tick 2121, paused,
and four historical FAILED run records; no production writes occurred yet.
