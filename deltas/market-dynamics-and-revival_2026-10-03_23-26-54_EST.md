# Delta: looser market dynamics and bounded distress recovery

- Created: 2026-10-03 23:26:54 EST (UTC-05:00, fixed standard time).
- Branch: `docs/market-dynamics-revival-delta`, based on `main` at `14d3fa5`.
- Status: proposed design only; not implemented or deployed.
- Authorization: document the discussed approach and safely merge a PR. The
  user's instruction not to implement remains in effect. Merging this document
  does not authorize runtime changes, a SPEC edit or a Maincloud publication.
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

These are deliberate policy choices, not defaults silently approved by merging
this document. Obtain approval for implementation and the corresponding SPEC
changes: section 6 currently specifies initial-price anchoring, and section 9
explicitly prohibits timeout-based cooldown while unsold inventory remains.
Revise related grant, event and client-contract wording as needed at that time.

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

## This PR's boundary and merge checks

This PR adds only this proposal. Leave `SPEC.md`, configuration, implementation,
bindings, credentials, databases and the running simulation unchanged. Check
Markdown formatting and the complete diff, push a dedicated branch, and merge
only the current tested head after CI passes and any new `main` changes are
reconciled. Record verification and the merge result in the PR; do not label
the proposed behavior implemented merely because this document has merged.
