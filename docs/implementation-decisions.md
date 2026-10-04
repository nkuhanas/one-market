# v0.2 implementation decisions

`config/v02.json` is the versioned workload configuration. Its exact UTF-8 bytes
are hashed with BLAKE3; formatting changes therefore change the configuration
hash in `market_state`. The run/result workload hash is BLAKE3 over the domain
`one-market-workload-v2` plus a NUL byte, the exact config bytes, selected
population as little-endian u64, seed as little-endian u64, and profile UTF-8
bytes, then `\0cadence\0`, cadence ID UTF-8 bytes and its interval as little-endian
u64. Thus selecting a different population, seed, market profile or cadence cannot reuse a
qualified workload hash. The compiled module and Rust harness share the pure
`one-market-core` crate. The build hash is SHA-256 of the published release WASM.

## Frozen baseline rules

- `one-market-v02-cadence-profiles-1` keeps the dynamics/revival economic rules
  and adds a versioned 20hz/10hz/5hz registry. 20hz is the default; scheduler and
  benchmark timings derive from the selected interval. All retain 20 buckets,
  so actor steps target 1/2/4 seconds respectively. Economic timers stay in
  logical ticks; human/load/measurement timers stay in wall-clock units.
  Per the user's revised load target, benchmarks use three ordinary production
  viewers (plus the human and evidence collector); historical ten-viewer results
  retain their original hashes and are not current-workload qualification.
- `cadence_state` is a public singleton; `run_cadence` privately snapshots each
  run's cadence, bucket count and first logical tick. No existing persistent
  row layout changes. A paused cadence change closes the old evidence segment
  and requires explicit `start_run`; it never resets balances, inventory, pending
  orders, news, recovery state or logical ticks. Continuations cannot qualify.
  Ordinary `recover_simulation` preserves its run's clock grid and failure.
  Legacy runs without a snapshot retain their historical 20 Hz interpretation.
- Detailed evidence remains bounded at six runs. Owner-only `prune_run_evidence`
  accepts `PRUNE RUN <id>`, removes at most 500 receipts per call, then removes
  that completed non-current run's metadata when empty. Archive first; selection
  does not prune automatically, and this operation never resets the world.

- Integer prices range from 1 to 100,000,000 cents. No floating-point settlement.
- Actors use SplitMix64 derivation, indexed buckets, and integer weighted signals.
  Quantity is capped at 10 shares and by available balances and risk budget.
  Noise and tie-breaking derive from the recorded seed, actor/order ID, and tick.
- `one-market-v02-dynamics-revival-1` retains the protected liquidation
  rules. Exiting actors offer at most `liquidation_max_quantity = 10` shares,
  with reserve `ceil(previous_price * (10000 - liquidation_discount_bps) / 10000)`;
  `liquidation_discount_bps = 500`. Clamp to the configured price range. They
  still require real completed liquidation before ordinary cooldown grants.
  A separate budgeted distress revival can retain unsold inventory.
- Tick phases: mark and check risk at the previous traded price; perform lifecycle
  or active policy; gather human reservations; clear; settle; mark at the new
  traded price; persist every due actor exactly once; commit evidence and feeds.
  Recapitalization returns an actor to ACTIVE but its next policy evaluation is
  its next due bucket. New drawdown exits may sell in the triggering auction.
- Absolute deadlines retain the original origin. A callback at least one slot
  late executes one logical tick, records the skipped following slots, and
  schedules the next future deadline on the original grid. It fails the run.
  There is no catch-up batch. A rolled-back tick requires authorized recovery;
  missing evidence prevents qualification. Pause/recovery never clear failure.
  Schedule generations and expected slot checks reject stale callbacks.
- Positive increasing `u64` human order IDs use a durable per-identity high-water
  mark. IDs at or below it are rejected without mutation, even after history
  pruning or world reset. A rejected new order does not consume its ID.
  One pending order per identity, 100-share maximum, one acceptance per 200 ms,
  and 1,000 total pending orders bound work. The suggested UI slippage is 100 bps.
- Retain 3,600 price points, 500 activity rows, 16 news rows, 64 sampled actors,
  32 order receipts per human, 8,192 detailed receipts per run, six detailed runs,
  and 20 public benchmark summaries. Durable accounting and deduplication use
  aggregate rows, not an unbounded transaction history.
- Public activity is deterministically sampled with at least 50 ms between
  records. Rates use cumulative counters and actual SDK timestamp intervals.
- Qualification uses 30 s warm-up, 180 s measurement, ten production-subscription
  viewers, five fixed-timeline offered human orders/sec, and three fresh worlds
  per profile. CHAOS begins at intended slot 1,200 for 1,200 logical ticks.
  The actor count will be modest; it is a baseline, not a maximum-capacity claim.

## Isolation and clients

Develop on a separate v0.2 local database. The existing scaffold database is
preserved. Schema migrations must never auto-delete its data. Keep `tick` and
`price` as deprecated aliases of `logical_tick` and `price_cents` in the public
market row so Kaleb's existing observer remains functional without redesign.
Private tables are not part of public subscriptions. Human views derive their
identity from the caller. Benchmark evidence is available only to an explicitly
authorized reader; generating private Rust types does not grant table access.

## Concrete policy and sampling version

`splitmix64-finalizer-v1` is the explicitly wrapping 64-bit finalizer in
`market-core/src/lib.rs`; financial arithmetic does not wrap. For
`bits = mix(seed xor actor_id)`, the four signed weights are the modulo-2,001
values at shifts 0, 12, 24 and 36, minus 1,000. Conviction is
`((bits >> 48) % 301) + 100`; risk tolerance is
`((bits >> 54) % 2001) + 1000`. These derivations, rather than a promise of a
uniform statistical distribution, define the reproducible population.

At each active due step, compute integer basis-point momentum from the previous
two traded prices, reversion toward the actor's private valuation, prior auction
quantity imbalance, and active news direction × severity × confidence.
`horizon = 200 * (1 + mix(actor_id) % 5)`; revision is
`(tick + mix(actor_id) % horizon) / horizon`, using a u128 intermediate.
`bias = mix(seed xor mix(actor_id) xor mix(revision)) % 4001 - 2000`.
Private fair value is `clamp(shared_reference * (10000 + bias) / 10000)`.
Reversion is `(fair - previous_price) * 10000 / previous_price`.
Signal is `(momentum_weight * momentum + abs(reversion_weight) * reversion *
1000 / 10000 - contrarian_weight * imbalance + news_weight * news) / 1000`,
plus `(sentiment + news * 1000 / 10000) * (1000 + news_weight / 2) / 1000`, then noise
`mix(seed xor mix(actor_id) xor mix(logical_tick)) % 2001 - 1000`.
Signed division truncates toward zero. Absolute signal below conviction passes.
Positive signal buys; negative signal sells.

For quotes, `anchor_bps = min(abs(reversion_weight), 1000) *
quote_reversion_bps / 1000`, where `quote_reversion_bps = 500`.
The reservation price is `previous_price + (fair - previous_price) *
anchor_bps / 10000`, using signed division truncated toward zero. This retains
existing stored weights/identities while treating mean reversion as restoring.
Limit allowance is `clamp(abs(signal) / 10, 1, 500)` bps around this reservation
price. Buy multiplication/division rounds **up**; sells round down. Clamp both
to permitted prices. Thus even an unanchored penny buy can quote two cents;
funded heterogeneous anchored bids support price discovery beyond the floor.
Desired quantity is
`clamp(abs(signal) / 100, 1, actor_max_quantity)` and is further capped by
`marked_equity * risk_tolerance / 10000 / limit` and affordable cash or owned
shares. Auction ties sort by `mix(mix(seed xor tick) xor order_key)`, then key;
actor keys are `2 * actor_id`, human keys are `2 * acceptance_sequence + 1`.
The acceptance allocator stays monotonic across explicit world resets, as do
run/event IDs and the per-identity deduplication watermark. Recorded IDs and
actual accepted human timing are inputs; repeats need not have identical fills.

At each epoch boundary, sentiment target is
`mix(seed xor mix(tick / 400) xor 0x6d6f6f64) % 101 - 50`.
Move sentiment one fourth of the target difference, using its sign for a
nonzero difference that would truncate to zero. Reference drift is sentiment
divided by 20 bps. Move the reference by that proportion, with a one-cent
signed step if nonzero drift would truncate to zero, and clamp to permitted
prices. Neither value returns automatically to $100. Both are persisted in
`market_dynamics`, updated once per tick together with health/recovery state.

The price remains the result of the unchanged auction and actual settlement.
There is no forced recovery price, invisible buyer, continuous peak decay or
share deletion. See SPEC §9 for the frozen distress thresholds, cohort timing,
inventory-retaining revival and explicit grant caps. `actor_recovery` is sparse
and private; `bucket_health` has exactly 20 rows. Reads/updates stay within the
due bucket. Revival skips policy in its transition tick, like ordinary
recapitalization. Existing actor/market/runtime row layouts remain unchanged.

For actors already EXITING during upgrade, the first new-policy bucket visit
starts a conservative exit timer. Subsequent ACTIVE→EXITING transitions reset
that timer without discarding the actor's grant history. Episode eligibility
is once per actor, even for zero-grant revivals. Bounded eligibility restoration
does not guarantee cash, fills, or departure from the penny floor; the native
no-cash/exhausted-budget fixture deliberately retains that counterexample.

## Workload upgrades

An ordinary non-destructive publish does not rewrite actor rows or erase old
evidence. Before a tick writes actors, compare the world's configuration hash
with the compiled configuration. A mismatch commits a stopped scheduler and a
FAILED run without advancing the tick. An owner may explicitly call
`recover_simulation` to adopt the new configuration without resetting inventory.
That continuation stays FAILED/non-qualifying, retains its original run hashes,
and records the adopted workload hash in its failure reason. It is not a new
measurement. Only a fresh world/run can qualify the new workload.
Explicit adoption seeds missing dynamics from the current traded price and
creates missing bucket-health rows, preserving existing dynamics on repeated
recovery/restart. Ordinary publication alone never backfills or resets actors.
The original failure reason is retained when appending recovery evidence.

The actor sample is the first 64 IDs. Public activity chooses at most one event
per tick: the first lifecycle transition in actor-ID order, otherwise the first
filled actor in that order, otherwise the first filled pending human in database
iteration order. The 50 ms rate guard also applies. This is a deliberately
bounded presentation sample, not an unbiased statistical sample or full audit.

## Milestone evidence

See [versions](versions.md) for the observed compatibility gate,
[methodology](benchmark-methodology.md) for qualification and retention, and
[handoff](backend-handoff.md) for executed checks and measured artifacts.
