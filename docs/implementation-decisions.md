# v0.2 implementation decisions

`config/v02.json` is the versioned workload configuration. Its exact UTF-8 bytes
are hashed with BLAKE3; formatting changes therefore change the configuration
hash in `market_state`. The run/result workload hash is BLAKE3 over the domain
`one-market-workload-v1` plus a NUL byte, the exact config bytes, selected
population as little-endian u64, seed as little-endian u64, and profile UTF-8
bytes. Thus selecting a different population, seed, or profile cannot reuse a
qualified workload hash. The compiled module and Rust harness share the pure
`one-market-core` crate. The build hash is SHA-256 of the published release WASM.

## Frozen baseline rules

- Integer prices range from 1 to 100,000,000 cents. No floating-point settlement.
- Actors use SplitMix64 derivation, indexed buckets, and integer weighted signals.
  Quantity is capped at 10 shares and by available balances and risk budget.
  Noise and tie-breaking derive from the recorded seed, actor/order ID, and tick.
- `one-market-v02-market-recovery-2` replaces the original pricing/liquidation
  rules. Exiting actors offer at most `liquidation_max_quantity = 10` shares,
  with reserve `ceil(previous_price * (10000 - liquidation_discount_bps) / 10000)`;
  `liquidation_discount_bps = 500`. Clamp to the configured price range. They
  still require real completed liquidation before cooldown and grants.
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
two traded prices, reversion from current price toward the initial price, prior
auction quantity imbalance, and active news direction × severity × confidence.
Signal is `(momentum_weight * momentum + abs(reversion_weight) * reversion -
contrarian_weight * imbalance + news_weight * news) / 1000`, then add noise
`mix(seed xor mix(actor_id) xor mix(logical_tick)) % 2001 - 1000`.
Signed division truncates toward zero. Absolute signal below conviction passes.
Positive signal buys; negative signal sells.

For quotes, `anchor_bps = min(abs(reversion_weight), 1000) *
quote_reversion_bps / 1000`, where `quote_reversion_bps = 2500`.
The reservation price is `previous_price + (initial_price - previous_price) *
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

The price remains the result of the unchanged auction and actual settlement.
There is no forced recovery price, invisible buyer, liquidation timeout, peak
decay, or share deletion. An entirely exiting fixed bucket still lacks autonomous
buyers; see the retained model counterexample in the
[market-recovery delta](../deltas/market-recovery_2026-10-03_22-05-19_EST.md).

## Workload upgrades

An ordinary non-destructive publish does not rewrite actor rows or erase old
evidence. Before a tick writes actors, compare the world's configuration hash
with the compiled configuration. A mismatch commits a stopped scheduler and a
FAILED run without advancing the tick. An owner may explicitly call
`recover_simulation` to adopt the new configuration without resetting inventory.
That continuation stays FAILED/non-qualifying, retains its original run hashes,
and records the adopted workload hash in its failure reason. It is not a new
measurement. Only a fresh world/run can qualify the new workload.

The actor sample is the first 64 IDs. Public activity chooses at most one event
per tick: the first lifecycle transition in actor-ID order, otherwise the first
filled actor in that order, otherwise the first filled pending human in database
iteration order. The 50 ms rate guard also applies. This is a deliberately
bounded presentation sample, not an unbiased statistical sample or full audit.

## Milestone evidence

See [versions](versions.md) for the observed compatibility gate,
[methodology](benchmark-methodology.md) for qualification and retention, and
[handoff](backend-handoff.md) for executed checks and measured artifacts.
