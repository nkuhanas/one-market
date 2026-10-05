# v0.2 client contract

The authoritative schema is `crates/spacetime/src/schema.rs`; public TypeScript
bindings are generated in `packages/bindings/src`. Run
`./scripts/generate-bindings` after interface changes. Do not hand-edit generated
files. SQL names are snake_case; generated TypeScript accessors and fields are
camelCase. u64/i64/u128 values are JavaScript `bigint`, not `number`. Prices and
cash are integer cents; SDK timestamps carry microseconds since Unix epoch.

## Observation

Production viewers subscribe to these seven bounded queries:

```sql
SELECT * FROM market_state
SELECT * FROM cadence_state
SELECT * FROM price_point
SELECT * FROM public_activity
SELECT * FROM news_event
SELECT * FROM actor_sample
SELECT * FROM benchmark_result
```

| Source             | Meaning / bound                                                                                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `market_state`     | Singleton `id=0`; completed logical ticks/epochs, current and previous traded prices, last matched volume, volatility, population counts, cumulative workload counters, rate timestamps, CHAOS flag, setup phase, base config hash |
| `cadence_state`    | Singleton `id=0`; selected profile, `tick_interval_us`, and `bucket_count`; drives cadence labels, not an independently hard-coded frontend target                                                                                 |
| `price_point`      | Last 3,600 ticks; actual price and matched volume, including zero-volume frozen prices                                                                                                                                             |
| `public_activity`  | At most 500 deterministic samples, at most one record per 50 ms; not a trade archive or throughput counter                                                                                                                         |
| `news_event`       | Last 16 news events; fixed direction/severity/confidence and start/end logical ticks                                                                                                                                               |
| `actor_sample`     | At most 64 actors; a sampled view, not the full private actor population                                                                                                                                                           |
| `benchmark_result` | Last 20 qualified summaries; three run IDs, environment/profile, population, workload/build/evidence hashes and measured counters                                                                                                  |

The old observer can keep using `tick` and `price`; they alias `logical_tick` and
`price_cents`. A receipt's zero-based logical tick describes the tick being
executed; the market row reports the number completed (one greater immediately
after that receipt). An epoch is 20 logical ticks.
Its target duration is one second at 20 Hz, two at 10 Hz, four at 5 Hz.
Use `PricePoint.recorded_at` for minute chart windows and horizontal spacing,
including history spanning pauses or cadence changes. Missing cadence metadata
renders as pending, never a guessed live target. Capacity selection matches the
current cadence; the result still explicitly names its environment/workload.

Compute rates from two cumulative-counter snapshots divided by their actual
elapsed timestamp interval, preferably at least the advertised 1,000,000 us
window. Detect reset/counter decrease and restart the sample. Do not count feed
rows or subscription callbacks. `matched_share_volume` counts each transferred
share once; filled orders count each participating order separately.

Only a `PASSED` benchmark summary supports a capacity label. Show its environment
and profile. `actor_count` in live market state is only the configured population;
LOCAL evidence cannot support a Maincloud headline. Start lateness is not reducer
execution duration.

## Human calls and private views

Persist the SDK identity token securely for reconnects; it is not a public
`VITE_*` value. Build connections with confirmed reads enabled and use the
generated per-call promise result, not a global reducer callback. Subscribe with
that same connection to `my_trader`, `my_pending_order`, and `my_recent_fills`.
Those caller-scoped views never accept a client-supplied identity.

```ts
await connection.reducers.enterMarket({});
await connection.reducers.placeOrder({
  clientOrderId: nextMonotonicId,
  side: 'BUY',
  quantity: 1n,
  limitPriceCents: 10100n,
});
```

`enter_market` is idempotent per identity. Initial cash is 10,000,000 cents and
shares are zero. The view exposes balances, reservations, current marked P&L,
timestamps, and completed-order count. Cash/shares include reserved resources;
available amounts subtract the corresponding reservation.

`place_order` accepts only `BUY`/`SELL`, quantity 1–100, and price 1–100,000,000
cents. The visible slippage default is 100 bps; the UI computes and displays its
limit, while the server enforces the submitted limit. Buy reservation is
`quantity * limit`; sell reservation is quantity. At most one pending order per
identity and one accepted order per 200 ms are permitted; the world caps pending
orders at 1,000. Rejections roll back all mutations.

An accepted order participates in the next committed auction, then its unfilled
remainder expires and all remaining reservations release. Acceptance is not a
fill. The private receipt reports requested/filled quantity, uniform price, tick,
and `FILLED`, `PARTIAL`, or `EXPIRED` status. Keep UI acceptance separate from this
settlement status. The last 32 completed orders are retained per human.

Client IDs are positive, strictly increasing u64 values. The server durably
rejects any ID at or below the highest accepted ID, even after receipt pruning
or an explicit world reset. Retry an uncertain call with the same ID: a duplicate
error does not mean the first attempt failed. Reconcile pending/recent state.
Persist the next ID alongside identity; do not restart it at one on reconnect.
There is deliberately no history-pruning shortcut that permits replay.

## Administrative and evidence boundary

`trigger_chaos()` is public for any connected identity; entering the market is
not required. The world must be READY. Active-shock requests succeed idempotently,
without extending the event or creating another. A new shock immediately updates
public news and `market_state.chaos_active` and invalidates current qualification.
It never starts ticks: on a paused world, actors wait for an explicit owner start.
CHAOS expires 60 wall-clock seconds after activation, including while paused.
Use `market_state.chaos_active` to show the latest news shock; `end_tick` is only
an initial cadence-based estimate until replaced with the actual end tick.
The private `chaos_expiry` schedule is not an observer subscription. Owner-only
`clear_chaos()` clears the shock without resetting the world or pausing it;
`expire_chaos` is scheduler-only.

Only the initial publisher is an administrator. Anonymous clients cannot change
population, initialize/reset, start/pause/recover/manual-step, adopt workload rules,
select cadence, prune evidence, authorize evidence readers, validate runs, or publish results. Even the publisher
cannot invoke `simulation_tick` as a client: it checks scheduler origin. The
manual `benchmark_step` wrapper is admin-only and refuses while scheduling is on.

`authorize_reader(identity)` grants the caller-scoped `benchmark_latest_receipt`
and `benchmark_runs` views. The first is an O(1) latest-receipt lookup; the second
returns at most six runs. This does not grant direct private-table access. The
Rust harness uses the database owner's authenticated private-table subscription
for complete retained receipts; generated private types alone grant nothing.
No public query should subscribe to `actor_state` or private human/evidence rows.

Ordinary publish/restart preserves state. Fresh initialization is bounded and
resumable; ticking begins only in READY. Pausing or recovering invalidates the
active qualification. Reset requires the explicit `RESET WORLD` confirmation and
bounded `reset_batch` calls; it is never an implicit startup action.

Owner cadence workflow: `pause_simulation`, `set_cadence_profile("10hz")`, then
`start_run("NORMAL", module_sha256, false)`. Selecting while enabled is rejected;
selecting the same profile is a no-op (use `recover_simulation` for that paused
segment instead). Existing-world starts are non-qualifying. Call selection before
the initial start to configure a fresh benchmark world. See the capacity worklog
for measured profiles and populations; availability is not qualification.

For an upgraded compiled workload that must stay paused, first call
`adopt_workload_paused(expected_configuration_hash)` as owner, then select the
profile (including `4hz`, 250,000 µs). Adoption rejects running worlds, remaining
schedules, and unexpected hashes. It retains historical evidence and leaves the
existing world waiting for a later explicit non-qualifying start.
