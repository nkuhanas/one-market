# Delta: recoverable market pricing and bounded liquidation

- Created: 2026-10-03 22:05:19 EST (UTC-05:00, fixed standard time).
- Status: implemented; verification recorded below. Merge status is tracked in
  [PR #3](https://github.com/nkuhanas/one-market/pull/3).
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

The first model test exposed a separate pre-existing limitation: one-tick
auctions only include the due fixed bucket. An entirely EXITING bucket has no
autonomous buyers, even if another bucket is healthy. A synthetic seven-survivor
200-actor world escaped the penny but ended with only 14 active actors after
40 simulated minutes. This failed recovery expectation is retained as an
explicit no-fabricated-recovery characterization. Recovery tests additionally
cover distressed inventories with funded buyers in every bucket, as observed
at 375k. Cross-bucket resting orders or lifecycle escape would require another
workload/architecture decision; this delta does not claim universal recovery.

### Implemented and verified

`423df72` committed this plan before implementation; `294aac9` implemented the
market fix. Production WASM SHA-256 is
`c1b23e38e9bcf821f88a2fb06b1fbc5c3659d3fb01c8dc2ba92a074a54f42e9c`, preserved
with provenance under `artifacts/builds/market-recovery/`.

- The six 40-minute deterministic NORMAL/repeated-CHAOS soaks (200 actors,
  three seeds) had zero floor ticks and 199–200 actors active at completion.
- Three distressed 1,000-actor fixtures, with funded buyers in each bucket,
  recovered from one cent to $99.59/$100.39/$101.38 and all 1,000 ACTIVE after
  20 simulated minutes. Conservation checks pass throughout. These are model
  tests, not measurements of persistent runtime capacity.
- Docker `check`, all 35 backend/transport tests, and all three browser tests
  pass. Publishing old-to-new preserves all eight checked tables exactly;
  real upgrade fencing/recovery preserves balances and original evidence.
- `main` received frontend PR #4 during verification. Merge `d4f18d5` preserves
  that interface and applies ordered transport in `use-one-market.ts`, retaining
  upstream's removal of its predecessor. Full checks and browser/restart tests
  were repeated against the combined tree without visual changes.
- The harness records bounded market-health samples on its existing subscribed
  market row; full lifecycle totals are read only after measurement stops.
  A preflight guard also rejects a runtime/harness workload-hash mismatch rather
  than labeling a historical module with new rules. A real old-module negative
  test stopped before offered load at tick zero, with no scheduled ticks; a
  matching module/harness 200-actor control passed (1+5 seconds). Final native
  checks pass 25 tests, with one archive-only qualification test ignored.

| 375k profile | Window   | Price range    | Final   | Floor / zero-volume ticks | Final active | P99 start lateness | Skips |
| ------------ | -------- | -------------- | ------- | ------------------------- | ------------ | ------------------ | ----- |
| NORMAL       | 30+90 s  | $99.62–$100.49 | $100.12 | 0 / 0                     | 375,000      | 17,922 µs          | 0     |
| CHAOS        | 30+170 s | $98.68–$101.38 | $99.93  | 0 / 0                     | 375,000      | 19,733 µs          | 0     |

Both pass the exploratory load/coverage/accounting gates. NORMAL measured
33,750,000 actor updates; CHAOS measured 63,750,000. Neither had wipeouts or
recapitalizations in these finite windows; targeted fixtures separately exercise
the new liquidation behavior. CHAOS includes 1,600 post-shock ticks (80 seconds),
trading between $99.60 and $100.47 with all actors active. The new restoring
policy is intentionally a changed economic workload, not a like-for-like
performance improvement or a promise that arbitrary markets cannot crash.

Full artifacts:

- `artifacts/exploration/20261004T031747Z-469269/375000-normal/`
- `artifacts/exploration/20261004T032215Z-497039/375000-chaos/`
- `artifacts/verification/20261004-market-recovery/verification.json`
- `artifacts/verification/index-migration-20261004T031443Z-446741/result.txt`

Reproduce with the corresponding compiled harness and preserved module:

```sh
POPULATION=375000 PROFILE=NORMAL WARMUP_SECONDS=30 MEASUREMENT_SECONDS=90 \
  MODULE_WASM=artifacts/builds/market-recovery/market-recovery.wasm \
  HARNESS_BIN=target/release/one-market-benchmark ./scripts/explore
POPULATION=375000 PROFILE=CHAOS WARMUP_SECONDS=30 MEASUREMENT_SECONDS=170 \
  MODULE_WASM=artifacts/builds/market-recovery/market-recovery.wasm \
  HARNESS_BIN=target/release/one-market-benchmark ./scripts/explore
```

Build the native harness through Docker first; do not reuse a binary compiled
for the old workload. These are one-off exploratory checks, not six fresh
confirmations. Existing data, failed experiments and qualification gates remain.
