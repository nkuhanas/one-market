# Delta: looser market dynamics and bounded distress recovery

- Created: 2026-10-03 23:26:54 EST (UTC-05:00, fixed standard time).
- Branch: `docs/market-dynamics-revival-delta`, based on `main` at `14d3fa5`.
- Status: implemented and in verification; original proposal committed as `d7481b3`.
- Authorization: after the documentation-only request, the user explicitly
  approved implementing this delta, updating SPEC to match, safely merging the
  PR, and then publishing to Maincloud and changing the live simulation. Preserve
  existing rows and evidence; no reset or population change is authorized.
- Related work: [market recovery](market-recovery_2026-10-03_22-05-19_EST.md)
  and [100k Maincloud deployment](maincloud-100k-deployment_2026-10-03_22-52-12_EST.md).

## Objective and evidence

Allow meaningful trends, selloffs and occasional temporary floor-price periods
without continuously steering the market back to $100. Restore participation
after sustained distress without deleting inventory, fabricating trades or
setting the traded price directly. This is a targeted evolution of the recovery
policy, not a wholesale revert of the earlier correctness fixes.

A read-only Maincloud observation at 2026-10-04 04:25:15 UTC found 100,000 total
and active actors. The retained 3,600 price points, ticks 20,978 through 24,577,
ranged from $99.35 to $100.67, with a mean of $100.003 and no zero-volume or
one-cent-floor ticks. This is a bounded observation, not a complete history or
a capacity qualification.

The current code provides two restoring influences: the absolute mean-reversion
weight drives the decision signal toward the initial price, and the quote
reference moves up to 25% of the gap toward that same $100 reference. Increasing
population does not remove this common bias; independent actor noise can cancel
in aggregate. See [policy](../crates/market-core/src/policy.rs),
[signal construction](../crates/spacetime/src/runtime.rs), and
[configuration](../config/v02.json).

## Preserve the existing safeguards

- Actual, funded buyers and covered sellers; unchanged uniform-price auction
  priorities and atomic settlement. Never manufacture a fill or reset price.
- Positive integer-cent prices, checked arithmetic and rounded-up buy limits
  that can escape the penny-rounding trap.
- Bounded, price-protected liquidation. Keep the existing 10-share slices and
  95% rounded-up reserve as the starting control; do not restore full-inventory
  asks at the absolute minimum.
- Persistent actor identities, inventories, strategies and lifetime counters;
  conserved shares, trade-conserved cash and explicitly accounted cash grants.
- Exactly one material update per due actor per completed epoch, including
  dormant actors; unchanged scheduler, access controls and failure evidence.
- Public capacity comes only from qualified evidence, not the live population.

## Proposed behavior

### 1. Loosen ordinary price formation

Reduce the always-on quote anchor substantially and evaluate weakening the
shared initial-price signal separately. Do not merely restore signed
anti-value reversion, which previously contributed to distressed-market traps.
Compare each change independently against the current policy before combining
them, so a new failure can be attributed to a specific rule.

Explore heterogeneous reservation values and response horizons rather than a
universal permanent $100 destination. Persistent shared sentiment or news,
with heterogeneous actor responses, is a candidate for sustained directional
pressure; raising independent per-actor noise alone is not the design goal.
Any new reference or sentiment process must be bounded, deterministic under a
recorded seed, versioned, and persisted if it carries state across ticks.
It changes orders, not the market price. No LLM agents or external price feed.

### 2. Recognize sustained distress without forcing a flatline

Use distinct sustained-distress conditions: a configurable floor/near-floor
price streak, or a low/no-volume streak together with depleted active
participation. A floor market with positive volume and an illiquid market above
the floor must both be represented. One low-priced trade or an unchanged price
with healthy trading must not trigger a rescue.

Distress observation/dormancy is an economic mode, not a scheduler pause:
ticks, persistent actor updates, human order handling and any executable trades
continue. The price may remain flat naturally when orders do not cross. Do not
force it to stay at the floor while a timer runs.

Freeze entry thresholds, streak lengths, recovery conditions and hysteresis
before implementation. Use completed logical ticks for deterministic economic
timers and report actual elapsed time separately. A stalled runtime cannot be
revived by a timer that needs future ticks; runtime recovery stays a separate
explicit owner operation. Prevent one good tick from repeatedly rearming grants.

### 3. Let stranded actors return with their inventory intact

Keep the ordinary fully-liquidated cooldown path. Add a separately identified,
bounded escape for actors stranded in EXITING during sustained distress. After
the approved wait, stop their liquidation obligation, preserve their cash and
unsold shares, and return them through a documented recovery transition. Do
not label retained inventory as sold or an aborted liquidation as completed.

Stagger eligible re-entry in deterministic, bounded cohorts within every due
bucket. Buyers in one bucket cannot rescue another bucket's one-tick auction.
Use existing indexed bucket work, not a full-population scan or mass rewrite.
Specify fair cohort selection so eligible actors cannot starve indefinitely.

Reset a returning actor's per-life risk reference to its post-recovery marked
equity, retaining lifetime losses and wipeout counts. Any recapitalization is a
recorded cash grant, never shares or trading profit. Prefer a bounded
target-equity top-up for inventory-retaining actors, rather than automatically
giving a full cash bankroll on top of their shares. Freeze the exact formula,
per-actor/episode and aggregate budgets, repeat limits and budget-exhaustion
behavior first. Preserve grant-adjusted lifetime P&L and expose cumulative
support so repeated rescues cannot hide inflation or losses.

### 4. Distinguish participation recovery from a price guarantee

The intended liveness contract is a bounded return to trading eligibility for
eligible stranded actors while ticks continue. It is not a guaranteed fill,
funding beyond an exhausted grant budget, or a guaranteed higher clearing price.
Funded bids still need executable sellers in the same auction; reactivation
alone does not prove that the penny price will move.

Recovery must be visible through bounded authoritative events/counters, not
described as wholly spontaneous trading. If the product requires a guaranteed
short maximum stay at $0.01, an explicit liquidity/quote-support intervention
needs a separate decision and tests. No invisible market maker, programmed
price rebound or reset-to-$100 is included in this proposal.

## Decisions to freeze before implementation

- Normal quote/signal anchor strengths; reservation-value distribution and
  time horizons; whether shared sentiment is necessary, and its exact rules.
- Floor/near-floor thresholds, volume/activity windows, minimum dwell, recovery
  hysteresis and retry/backoff limits. No numerical recovery-time promise yet.
- EXITING eligibility/wait rules, transition labels, per-bucket cohort rate and
  a completed-tick liveness bound including the cohort-selection delay.
- Grant target/formula and budgets; behavior when retained inventory has value
  but an actor has no spendable cash; handling of repeated distress.
- Minimal persistent state, migration/backfill rules and public observability.
  Any schema change requires regenerated bindings and coordinated consumers.

These are deliberate policy choices. Implementation and corresponding SPEC
changes have now been explicitly approved. Section 6's initial-price anchoring
and section 9's inventory/lifecycle rules must be revised together with grant,
event and client-contract wording. Final measured parameters will be recorded
below before release; model comparisons are not capacity qualifications.

## Future acceptance and rollout

1. Compare the current policy, weakened anchoring alone and the combined recovery
   design in deterministic multi-seed NORMAL/repeated-CHAOS model soaks. Include
   distressed initial balances, an entirely EXITING bucket, every bucket
   EXITING, no cash, retained high-value inventory, tiny populations, sustained
   penny trading, zero volume above the floor and exhausted grant budgets.
2. Measure price range/drift, floor and zero-volume streaks, time to restored
   eligibility and separately time to renewed fills/above-floor trades,
   active/exiting/cooldown counts, wipeouts and cumulative grants. Acceptance
   is not simply "price never touches one cent" or "eventually returns to $100".
   Publish failures and unresolved counterexamples, not only favorable seeds.
3. Test conservation, exact-once grants, cohort fairness, threshold hysteresis,
   restart persistence, rollback, authorization and full actor-update coverage.
   A healthy flat-price market must not receive support, and repeated recovery
   must respect its budgets. Timers cannot duplicate transitions after restart.
4. After implementation is authorized, run Docker `check`, `backend-smoke` and
   `smoke`. Use isolated test worlds; do not reset or perturb the live 100k world
   for experiments. Validate market dynamics separately from runtime cadence.
5. Version/hash the changed economic workload and preserve old run evidence.
   Keep the 375k local exploratory baseline separate from the 100k Maincloud
   population; neither establishes qualification for a changed policy. No six
   fresh capacity confirmations are requested by this documentation delta.
6. A later deployment needs explicit approval, non-destructive publication and
   reviewed migration rules. Retain the existing workload-change fence and
   require explicit owner recovery for an upgraded live world. Economic revival
   must never rehabilitate FAILED run evidence or re-anchor scheduler deadlines.

## Implementation decisions and merge checks

The implementation will use additive singleton/bucket-health tables and a sparse
private per-actor recovery record; existing actor and market row encodings stay
intact. Old-world state initializes only after explicit workload adoption, not
as an implicit reset. Recovery work stays within the due indexed bucket.

Initial model candidates: a 1% maximum quote pull, a 10% signal-reversion scale,
actor-specific valuation offsets/horizons, and bounded shared sentiment with a
slowly evolving reservation reference. Compare the old policy and each weaker
anchor separately before selecting the final versioned settings.

Distress candidates: a price at or below 10 cents for 600 completed ticks, or
zero-volume/low-active participation for 600 ticks. Track isolated illiquid
buckets as well as whole-market distress. Initial recovery candidates use a
600-tick exit wait, 20 staggered cohorts per bucket, a 1,200-tick recovery window
and 1,200-tick retry backoff. One actor can receive revival support once per
episode, with a lifetime revival-grant cap and per-episode/world budgets.
Budget exhaustion never deletes inventory or prevents eligibility restoration.
Ordinary fully-liquidated recapitalizations remain separately accounted.

Review and measure these candidates, freeze the final formulas in configuration
and SPEC, and regenerate bindings rather than editing them. Require complete
local verification and current-head CI before merging without bypasses. Only
then publish the merged production WASM to the existing Maincloud database with
`--delete-data=never`, verify preserved state, explicitly recover the fenced
run, and check live progress. Keep its original FAILED evidence and hashes.

## Selected behavior and measured model evidence

The selected defaults are a **5% maximum quote pull**, **10% signal reversion**,
±20% private valuation offsets on staggered 200–1,000-tick horizons, and a
shared sentiment target bounded to ±50 bps. The shared reference evolves once
per epoch; it is not the traded price and has no permanent $100 destination.
The exact seeded formulas are in SPEC §6 and `docs/implementation-decisions.md`.
Distress/revival timers and budgets use the candidates above, now frozen in
configuration and SPEC §9: 10-cent/600-tick floor window, 10% ACTIVE plus zero
volume, 30 illiquid visits for an isolated bucket, 600-tick exit wait, 20 cohorts,
1,200-tick episode/backoff, 400 healthy ticks, $100k lifetime per-actor revival
cap, 25% episode and 100% lifetime world-bankroll revival budgets. Ordinary
fully-liquidated recapitalizations remain separately accounted and uncapped by
the revival budget; neither kind of grant is lifetime trading profit.

Native models use the production policy, auction, lifecycle and revival code,
but replace the database/clock. These are deterministic economic observations,
**not runtime capacity qualifications or wall-clock soaks**. Selected results:

| Model (seed 20261003 unless noted)                        |  Ticks | Price range    | Final ACTIVE | Notes                                                   |
| --------------------------------------------------------- | -----: | -------------- | -----------: | ------------------------------------------------------- |
| Old policy, 100k                                          | 12,000 | $99.37–$100.65 |      100,000 | No grants/floor ticks                                   |
| Only quote pull reduced to 5%, 100k                       | 12,000 | $99.28–$100.71 |      100,000 | Little independent effect                               |
| Only signal reversion reduced to 10%, 100k                | 12,000 | $98.48–$101.35 |      100,000 | Little independent effect                               |
| Selected full policy, 100k                                | 12,000 | $93.38–$107.75 |      100,000 | Final $102.44; no grants/floor ticks                    |
| Selected full policy, repeated CHAOS, 100k                | 48,000 | $0.19–$352.54  |      100,000 | Final $105.74; 534,966,241 matched shares               |
| All 200 actors EXITING at a penny; reference also a penny | 12,000 | $0.01–$1.13    |          200 | All revived by tick 1,020; left floor after 1,221 ticks |

The 100k repeated-CHAOS model recorded 379,265,425,360 cents of ordinary
recapitalization grants and no inventory-retaining revival grants. That is
substantial explicit monetary support, not organic investment profit.
Three-seed 200-actor NORMAL/repeated-CHAOS 48,000-tick regressions
(20261003, 42, 987654) ended with 187–200 ACTIVE and no floor ticks. Distressed
1,000-actor fixtures for those seeds left the penny after 704 ticks and ended
with all 1,000 ACTIVE; both cash and shares were audited against grants.

Rejected candidates are retained here: 1% quote pull/±200 bps sentiment at 100k
ended at $2.07 with only 26,326 ACTIVE after 12,000 ticks. Reducing sentiment
to ±50 bps restored the 100k NORMAL case, but the 200-actor NORMAL soak still
ranged $1.81–$723.17 and missed the existing 75%-ACTIVE regression (149/200).
The selected 5% pull passes that unchanged regression across all three seeds.

An exhausted-budget/no-cash fixture still has zero fills and a penny price
after all actors become ACTIVE. Revival restores eligibility, not purchasing
power beyond the caps or a guaranteed clearing-price rebound. This limitation
is explicit; do not use actor reactivation alone as proof of market health.

## Verification and rollout record

- Docker `check`: passed (format/lint/types/build, Rust tests/clippy, binding freshness).
- Docker `backend-smoke`: 36 passed, including private recovery-table access,
  grant/inventory persistence, rollback on a revival tick, workload fencing,
  and idempotent recovery. A test-only bounded stepping reducer exercises real
  production phases without changing the production module's interface.
- The accelerated test initially expected a future-grid callback immediately;
  fixed the test to verify recovery without re-anchoring the runtime schedule.
- Docker `upgrade-smoke`: additive schema only; old actor/account/order/evidence
  fingerprints survive publication and explicit adoption, with conserved assets
  and original FAILED run hashes/reason retained across local service restart.
- Docker browser `smoke`: 4 passed, including independent observers, reconnect,
  lifecycle event classification and ordered transport. Restart/republish kept
  the tick history and a single schedule in an isolated local world.
- Final-current-head CI, merge and live publication: pending.
- Frontend activity rendering now distinguishes wipeouts, cooldown,
  recapitalization and inventory-retaining revival from filled trades. Unknown
  events fail closed as lifecycle updates. Existing observer subscriptions,
  public market-row layout and visual design remain unchanged.
