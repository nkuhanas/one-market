# Delta: recoverable market pricing and bounded liquidation

- Created: 2026-10-03 22:05:19 EST (UTC-05:00, fixed standard time).
- Status: implementation planned before code changes; verification pending.
- Branch: `perf/actor-capacity-delta`, extending PR #3 before a verified merge.
- Authorization: user requested this delta, implementation, and a safe merge;
  subsequent “go ahead” approves the proposed spec revision and versioned rules.
- Scope: backend pricing/lifecycle, deterministic regressions, market-health
  evidence, and documentation. No UI redesign or production deployment.

## Evidence and objective

The retained 375,000-actor NORMAL probe traded between $85.69 and $108.53.
The CHAOS probe peaked at $201.05, fell from $98.12 to $0.01 in one tick,
and remained there for its last 38.6 seconds. It ended with 263,469 exiting
actors holding 89% of all shares, although trades and persistent updates
continued and cash/share accounting balanced. The older 325k CHAOS evidence
already contains this pathology; it is not caused by the direct-index change.

Three mechanisms interact: all-inventory liquidation at the absolute minimum
creates a distant auction candidate; integer-truncated percentage bids cannot
increase a penny quote; and signed “mean reversion” weights give some surviving
cash holders a permanently anti-value signal at distressed prices. Merely
delaying exit, or increasing benchmark capacity, does not repair these.

375k is the user-accepted working baseline, **not a newly six-run-qualified
capacity**. The interrupted qualification and prior failed artifacts remain.

## Versioned changes

1. Replace minimum-price/full-inventory liquidation with at most 10 shares per
   due epoch, reserved at 95% of the prior traded price, rounded **up** to cents.
   Freeze both settings in the workload configuration. The auction and its
   price-selection priorities stay unchanged; actual buyers are still required.
2. Make mean reversion genuinely restoring: use the magnitude of the persisted
   reversion weight, preserving actor identities and stored strategies without
   a population rewrite. Keep the other heterogeneous signals and seeded noise.
3. Anchor each active quote partway toward the existing initial-price reference:
   at most 25% of that gap, scaled by the actor's reversion-weight magnitude.
   Apply the existing bounded signal allowance around that reservation price.
   Round buy limits up, sells down, and enforce affordable/covered quantities.
   This creates real, funded valuation-based bids in distressed worlds, not an
   invisible market maker or an override of the traded price.
4. Keep the 50% life-peak drawdown rule, actual completed liquidation before
   cooldown, the 20-tick cooldown, grant accounting, and share conservation.
   No timeout-to-cooldown with unsold shares, peak decay, fictitious fills,
   inventory deletion, price reset, or new cash source.
5. Update SPEC §6/§9 and implementation decisions to record these approved
   semantics. Version/hash the changed workload. Prior qualified results do not
   qualify the new workload; do not change the three-confirmation gates.

## Persistence and compatibility

Keep the public/private schemas and generated interfaces stable if possible.
Publishing must preserve all rows and the single schedule. A code/configuration
upgrade must not let an in-progress run mix workload versions under its old
hash: invalidate/stall it explicitly on a configuration mismatch and allow only
an acknowledged non-qualifying continuation. Never erase old run evidence.
Old worlds can retain inventory and actor weights; they are not silently reset.

## Acceptance and verification

- Unit tests: percentage rounding and extreme integers; funded penny bids;
  bounded, price-protected liquidation; partial fills/no buyers; a real clearing
  above the penny floor; no grant before completed liquidation.
- Deterministic multi-epoch simulation tests using the production policy,
  auction and lifecycle: NORMAL, CHAOS, long post-shock recovery, distressed
  starting inventory, accounting, and continued active participation. These
  tests are model diagnostics, never persistent-runtime capacity evidence.
- Real-runtime backend regressions cover liquidation limits and price
  protection, no-buyer persistence, and safe version-change handling.
- Docker-backed `check`, `backend-smoke`, and `smoke`; generated bindings remain
  checked and are regenerated if any interface changes.
- One NORMAL and one extended CHAOS exploratory run at 375k with post-shock
  observation and market-health summaries: price extrema/floor streaks,
  active/exiting/cooldown counts, wipeouts/grants, volume, conserved balances,
  persistent updates, and deadline evidence. No six fresh confirmations.
- Preserve failed experiments and report any counterexample. A finite soak is
  not proof of universal recovery: no buyers can still mean no trades.

## Merge safety

Keep the existing transport/pause-test/index work. Fetch and reconcile main,
review the complete diff for unrelated changes or secrets, commit focused
Conventional Commits, push the PR branch, and require current-head CI before
merging without force pushes or bypassing protections. Retain all databases,
old modules, and historical benchmark artifacts. Record final verification and
the merge result below; circle back if a meaningful safety gate fails.

## Implementation results

Pending.
