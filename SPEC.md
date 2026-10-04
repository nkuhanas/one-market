# One Market — Technical Spec v0.2

**Repository:** `one-market`

**Product name:** **One Market**

**Conditional branding:** **One Market: One Million** only if the deployed benchmark actually sustains ≥1,000,000 actors under the defined workload. Publish only measured, qualified results.

**Team**

- **Chace** — backend/runtime, SpacetimeDB, Rust, benchmarking, Maincloud
- **Kaleb** — frontend, UX, visualization, Vercel, pitch/demo presentation

**Status:** This is the target implementation contract. The current scaffold proves a shared clock and client/runtime connection; it does not yet implement the v0.2 market, lifecycle, benchmark, or access-control contract. The amendments below supersede the v0.1 settlement, bankruptcy, timing, and client-data assumptions.

## 1. Project thesis

**One Market is a globally shared synthetic market where humans and a very large population of autonomous policy actors participate in the same persistent real-time state.**

The primary technical experiment is:

> **How many persistent autonomous actors can SpacetimeDB sustain in a continuously ticking shared simulation before it can no longer maintain the target tick cadence?**

The market exists because it provides an intuitive workload with:

- shared mutable state,
- contention between actors,
- persistent individual state,
- heterogeneous behavior,
- human + autonomous participation,
- a fixed baseline of actor writes with variable settlement and lifecycle work,
- and immediately understandable emergent behavior.

This is **not primarily a finance project**. It is a real-time actor-runtime and SpacetimeDB scalability experiment presented through a market people can understand instantly.

---

## 2. Headline experience

Anyone should be able to open the deployed site from anywhere and immediately observe **the same market**.

Illustrative values only:

```text
ONE MARKET

Persistent Actors                   487,500
Connected Identities                     38
Current Price                         $72.41
Filled orders / sec                   18,293

Verified capacity: 612,500 persistent actors @ 20 Hz

              [ LIVE PRICE GRAPH ]

RECENT ACTIVITY
#49102 BUY FILLED
#18291 WIPED — DRAWDOWN LIMIT
HUMAN 0x42AF BUY FILLED
#88201 SELL FILLED

           [ ENTER MARKET ] [ Benchmark details ]
```

A visitor can observe anonymously, enter with a synthetic bankroll, place a buy or sell, see accepted orders and actual fills, and watch autonomous actors respond to CHAOS. Human controls may hide the limit-order mechanics behind a visible slippage allowance.

Humans and autonomous actors use the **same authoritative SpacetimeDB market state**. An accepted order is not a guaranteed fill. A sell panic without buyers can freeze the last traded price; this is a valid outcome.

The capacity headline comes from a qualified `BenchmarkResult`, never from the selected live population. Methodology and diagnostics stay behind **Benchmark details**.

---

## 3. Stack

| Component                      | Technology                                |
| ------------------------------ | ----------------------------------------- |
| Monorepo                       | Git                                       |
| Backend/runtime                | Rust                                      |
| Database + authoritative state | SpacetimeDB                               |
| Production DB/runtime          | SpacetimeDB Maincloud                     |
| Frontend                       | React + TypeScript + Vite                 |
| Frontend deployment            | Vercel                                    |
| Local environment              | Docker / Docker Compose                   |
| Benchmark harness              | Rust                                      |
| Client/server integration      | Generated SpacetimeDB bindings            |
| Public transport/sync          | SpacetimeDB client subscriptions/reducers |

Use exact tested dependency versions and commit the lockfiles. Compatibility is established against the deployed stack through the gate in section 19; documentation examples from different versions are not an implementation contract.

---

## 4. High-level architecture

```text
                         ONE MARKET

 ┌──────────────────┐                   ┌──────────────────┐
 │ Kaleb            │                   │ Chace            │
 │                  │                   │                  │
 │ React / TS / UI  │                   │ Rust runtime     │
 │ Vercel           │                   │ actor policies   │
 │ visualization    │                   │ scheduler        │
 │ human controls   │                   │ market clearing  │
 └────────┬─────────┘                   │ benchmark        │
          │                             └────────┬─────────┘
          │ subscriptions / reducers            │
          │                                     │ module logic
          ▼                                     ▼
        ┌───────────────────────────────────────────┐
        │              SpacetimeDB                  │
        │                                           │
        │ actor rows · human rows · market state    │
        │ tick scheduler · events · metrics         │
        │                                           │
        │          AUTHORITATIVE WORLD STATE        │
        └───────────────────────────────────────────┘
                          │
                     Maincloud
```

There is **no conventional REST backend**.

SpacetimeDB is the integration boundary between Chace and Kaleb.

---

## 5. Simulation clock

### Base clock and intended deadlines

**20 Hz global simulation**:

```text
tick_interval_us = 50,000
20 logical ticks = 1 logical epoch
1 logical epoch targets 1 second of wall time
```

An epoch is only one wall-clock second when the cadence is maintained. Do not infer elapsed time from processed tick counts during degradation.

Use **absolute-time scheduled tick records**, each carrying an explicit intended slot number. Maintain at most one outstanding next tick. Assign each deadline before its callback runs:

```text
intended_at(slot) = run_start + slot × 50,000 microseconds
start_lateness_us = invoked_at - intended_at
```

`run_start`, `intended_at`, and `invoked_at` use SDK timestamps. Slot arithmetic uses checked intermediates. Never derive the intended deadline by flooring actual arrival time, and never re-anchor the schedule after a slow tick.

SpacetimeDB supports absolute-time schedules. Its native interval scheduler skips missed intervals, so counting callbacks alone cannot establish maintained cadence. [Schedule tables](https://spacetimedb.com/docs/tables/schedule-tables/).

If execution falls behind, explicitly record missed application slots and schedule debt. Do not silently omit work, relabel a delayed callback as on time, or count a giant catch-up batch as real-time operation. Keep intended slots distinct from completed logical ticks; receipts must make any gaps visible. A skipped slot fails qualification.

`ctx.timestamp` records invocation/start time and remains constant during the reducer; it is not an execution stopwatch. [Reducer context](https://spacetimedb.com/docs/functions/reducers/reducer-context/).

### Baseline actor scheduling

Every persistent actor belongs to one of **20 epoch buckets**:

```text
bucket = deterministic_hash(actor_id) % 20
due_bucket = logical_tick % 20
```

Each actor is stepped and its row materially updated **exactly once per completed logical epoch**, including actors that pass, exit, or cool down. Only `ACTIVE` actors perform their normal policy evaluation. Risk checks occur when the actor's bucket runs, not instantaneously across the population.

At a maintained cadence, `1,000,000` actors imply approximately `50,000` actor steps per tick and `1,000,000` baseline actor updates/sec. Actual bucket sizes and committed coverage are verified rather than assumed.

Faster cadence classes are a stretch goal. The published headline always uses a fixed, versioned scheduling profile.

---

## 6. Actor model

Actors are cheap heterogeneous policies, **not LLM agents or neural networks**. Private `ActorState` stores at least:

```text
actor_id
cash_cents
shares
marked_equity_cents
initial_endowment_value_cents
life_peak_equity_cents
cumulative_recapitalization_grants_cents

momentum_weight
mean_reversion_weight
contrarian_weight
news_weight
risk_tolerance_bps
conviction_threshold_bps

bucket
last_step_tick
status                    // ACTIVE | EXITING | COOLDOWN
cooldown_started_tick     // optional until liquidation completes

lifetime_pnl_cents         // signed, grant-adjusted
wipeout_count
filled_order_count
```

`RECAPITALIZED` is the recorded transition from cooldown back to active trading; identity, strategy, and lifetime statistics persist.

Population generation uses an explicitly seeded deterministic generator or deterministic per-actor derivation. Record the seed, generator version, and policy configuration. Do not use `ctx.rng()` as the benchmark population generator: the Rust reference describes its seed as the reducer invocation timestamp. [Rust reducer context](https://docs.rs/spacetimedb/latest/spacetimedb/struct.ReducerContext.html#method.rng).

### Policy output

The decision space remains:

```text
BUY(quantity, limit_price_cents)
SELL(quantity, limit_price_cents)
PASS
```

Quantity and limit price are internal policy outputs. Conceptually:

```text
signal = momentum_weight × momentum
       + mean_reversion_weight × mean_reversion
       + contrarian_weight × crowd_signal
       + news_weight × news_signal
       + deterministic_actor_noise
```

Signal magnitude determines conviction and sizing. Buys must be affordable at their limit price; sells must be covered by owned shares. Version the policy, sizing, limit-price, and noise rules in the benchmark configuration.

The market-recovery policy uses the magnitude of the stored mean-reversion
weight so reversion is restoring, while momentum, crowd and news responses
remain heterogeneous. Active limit prices use an actor-specific reservation
price anchored partway toward the initial-price reference. Buy limits round up
to integer cents; sell limits round down. Freeze the anchor strength and exact
formula in the workload configuration. This changes submitted orders, never
the traded price directly, and introduces no synthetic counterparty.

---

## 7. Persistent actor-state requirement

**Authoritative actor state must live in SpacetimeDB.** A private Rust vector containing the real actor population, with only aggregate values written to the database, does not satisfy the experiment.

Permitted optimizations include bucketing, batching, indexes, compact rows, reduced allocations, efficient iteration, bounded history, and aggregate subscriptions. External native simulation services and nonpersistent authoritative actors are excluded from the headline benchmark.

Every due actor incurs a material persistent row update, including `PASS`, `EXITING`, and `COOLDOWN`. At minimum update `last_step_tick`, marked equity, and runtime/lifecycle state; fills additionally update balances and lifetime counters. A complete epoch with `N` actors therefore commits `N` baseline actor updates.

Count all actor steps separately from normal policy evaluations. Exiting sell instructions and cooldown bookkeeping do not pretend to be normal policy evaluations. Tick receipts and per-bucket coverage must prove the full workload was performed.

---

## 8. Market model and settlement

### Initial conditions and units

The MVP has one entirely synthetic asset, **`ONE`**, and no debt, shorting, fees, or invisible market maker.

| Property                      | v0.2 default                                          |
| ----------------------------- | ----------------------------------------------------- |
| Starting price                | `$100.00` = `10,000` cents                            |
| Agent endowment               | `$50,000` cash = `5,000,000` cents, plus `500` shares |
| Initial agent endowment value | `$100,000` = `10,000,000` cents at the starting price |
| Initial share supply          | Exactly `500 × initial_agent_count`                   |
| Human endowment               | `$100,000` cash = `10,000,000` cents, zero shares     |
| Cash and prices               | Integer cents, `u64`                                  |
| Share quantities              | Whole shares, `u64`                                   |
| Arithmetic intermediates      | Checked `u128` wherever multiplication could overflow |
| Debt, shorting, fees          | None                                                  |

Check arithmetic and conversions before storing results; overflow must never wrap. Prices remain positive. The numeric minimum permitted price is an implementation parameter to freeze before market implementation.

Initialize the population before a benchmark run. Resizing or resetting during measurement invalidates that run. Share conservation is measured within an initialized world; a reset begins a new world with a newly recorded initialization.

### One-tick uniform-price batch auction

Every tick gathers due actors' intents and accepted human orders for **one auction**. Orders are good for this auction only; unfilled remainders expire after clearing. There is no persistent order book and no fabricated fill.

For each candidate price `p`:

```text
D(p) = sum of buy quantities whose limit_price_cents >= p
S(p) = sum of sell quantities whose limit_price_cents <= p
Q(p) = min(D(p), S(p))
```

Candidate prices are the submitted limit prices plus the previous traded price. Choose the price by the following priority:

1. Maximum executable quantity `Q(p)`.
2. Minimum unmatched imbalance `abs(D(p) - S(p))`.
3. Minimum distance from the previous traded price.
4. Lower price.

All fills execute at that single clearing price. Allocate buys by higher-limit-price priority and sells by lower-limit-price priority, with deterministic seeded tie-breaking among equally priced orders. Partially fill marginal orders. **Total shares bought must equal total shares sold exactly.**

When `Q(p)` is zero for every candidate, there are no fills and the last traded price stays unchanged. The executable orders determine price; there is no separate imbalance/depth equation that moves it before settlement. A sell panic without actual buyers can produce a frozen market instead of a crash.

### Human order reservations

The public call is:

```text
place_order(client_order_id, side, quantity, limit_price_cents)
```

Permit **one outstanding order per human identity**. A buy reserves `quantity × limit_price_cents`; a sell reserves the requested shares. Acceptance validates positive quantity, the permitted price range, order-size/rate limits, and **available** balances:

```text
available_cash_cents = cash_cents - reserved_cash_cents
available_shares = shares - reserved_shares
```

Repeated submission of the same caller-scoped client order ID must not create another order or reserve balances again. Settlement consumes the actual fill at the clearing price, releases all unused reservations, and expires the remainder. A price improvement releases the unused portion of a buy's reservation too.

Kaleb may present simple buy/sell controls with a visible slippage allowance while sending the full limit-order contract.

### Atomic boundary and invariants

Actor updates, clearing, balance transfers, reservation release, lifecycle changes, fill receipts, and the resulting tick receipt belong in **the same reducer transaction**. SpacetimeDB rolls back reducer changes on failure, supporting this atomic boundary. [Transactional reducers](https://spacetimedb.com/docs/functions/reducers/#transactional-execution).

Required invariants:

```text
cash_cents >= 0
shares >= 0
reserved_cash_cents <= cash_cents
reserved_shares <= shares

total shares are conserved after initialization
trading conserves cash
cash creation occurs only through explicitly recorded grants
```

Record initial endowments, human entry grants, and recapitalization grants so created cash is accountable. No fill can use a nonexistent counterparty or uncovered balance.

Call the activity metric **filled orders/sec**. Count an order once if it receives a nonzero fill in its auction; count matched share volume once for the transferred shares. Do not call the two filled sides separate trades. A future matched buyer–seller trade-pair metric requires an explicit pairing/counting definition.

---

## 9. Drawdown wipeouts and recapitalization

With no debt, nonnegative cash and shares, and a positive price:

```text
marked_equity_cents = cash_cents + shares × price_cents >= 0
```

A price decline alone does not create insolvency. A wipeout is a **simulation risk limit**, not negative net worth, bankruptcy, or a margin call.

Default trigger:

> An actor is wiped when its marked equity falls to **50% or less of its current life's peak equity** (`5,000` basis points).

Maintain the per-life peak and evaluate this condition when the actor's bucket runs. Do not advertise instantaneous risk detection across the full population.

### Lifecycle

```text
ACTIVE
  ↓ drawdown limit breached
EXITING
  ↓ remaining shares actually sold
COOLDOWN
  ↓ 20 logical ticks elapsed
RECAPITALIZED → ACTIVE
```

An exiting actor replaces its normal policy with a bounded liquidation slice
whenever its bucket runs. The market-recovery defaults are at most 10 remaining
shares per due epoch, with a reserve of 95% of the previous traded price rounded
up to cents and clamped to the permitted range. Freeze and version both the
quantity cap and discount. Actual buyers are required. Partial fills leave it
exiting; no buyers means no instant liquidation. If it has no shares remaining,
it enters cooldown and records the cooldown start tick. Elapsed time alone
never discards inventory or moves an actor into cooldown.

Recovery is conditional on executable counterparties. Because auctions contain
only the current due bucket plus accepted human orders, an entirely exiting
bucket cannot autonomously recover without a buyer. Do not promise universal
recovery, manufacture fills, or hide the stalled population. Policy regressions
must distinguish this illiquidity from an integer-rounding penny-price trap.

After 20 logical ticks have elapsed, its next due bucket update grants only enough cash to restore its bankroll to `$100,000`:

```text
recapitalization_grant_cents = max(0, 10,000,000 - cash_cents)
```

Record the grant, reset the per-life peak to post-grant equity, and return the actor to `ACTIVE`. Never mint its original 500 shares again. Retain its identity, strategy, wipeout count, and lifetime statistics.

Lifetime performance is grant-adjusted:

```text
lifetime_pnl_cents = current_marked_equity_cents
                   - initial_endowment_value_cents
                   - cumulative_recapitalization_grants_cents
```

Compute the subtraction in checked signed arithmetic. Free recapitalizations must not appear as investment profits.

Every state continues receiving its bucketed persistent row update; only trading behavior changes. Presentation may show:

```text
☠ AGENT #418201 WIPED — DRAWDOWN LIMIT
Lifetime wipeouts: 7
Lifetime P&L: -$381,291
```

---

## 10. CHAOS

`CHAOS` is both a demonstration mechanic and a stress workload. It is **admin-only**.

A shock introduces an obviously fictional scandal, for example:

> **ONE Industries admits its lunar revenue division does not actually exist.**

A versioned `NewsEvent` carries a headline, direction, severity/confidence in basis points, and logical start/end ticks. It modifies actors' news signals rather than hard-coding a price crash:

```text
news shock → individual policy evaluations → more buy/sell orders
           → auction clearing and actual settlement
           → possible price changes, drawdown stop-outs, and contrarian responses
```

Price movement and exits depend on executable counterparties. A frozen market is a valid response when nobody buys.

Because every due actor already persists an update, normal and CHAOS conditions have the same baseline `N` actor updates per completed epoch. CHAOS increases order participation, clearing work, settlement work, lifecycle transitions, and additional persistent records. Measure those changes; do not claim that only 5% of actors write normally while 90% write during CHAOS.

Qualification uses a fixed, versioned shock at a predetermined intended slot, with the rest of the workload unchanged.

---

## 11. Human traders

Visitors do not need conventional account registration. The SDK-authenticated caller identity may create one lightweight human trader through `enter_market()`; re-entering does not issue another endowment.

Private `HumanTrader` stores identity, `cash_cents`, `shares`, `reserved_cash_cents`, `reserved_shares`, signed `pnl_cents`, and `created_at`. Humans use the same auction and reservations defined in section 8, with no derivatives, shorting, or leverage.

The server enforces one trader and one outstanding order per identity, idempotent client order IDs, order-size limits, rate limits, and available-balance validation. Browser controls are not authorization or validation.

Human traders **do not count toward the autonomous actor capacity number**. Distinguish:

- `actor_count`: all persistent autonomous actors, including exiting/cooldown actors.
- `active_actor_count`: actors currently eligible for normal policy trading.
- `registered_human_trader_count`: human identities with a trader record.
- `connected_identity_count`: distinct currently connected identities, not connections or registered traders.

---

## 12. Typed, private, and bounded client contract

Chace and Kaleb agree on this contract before splitting runtime and presentation work. The following records define required semantics; generated bindings provide the exact tested SDK types.

### Names and units

| Value                                 | Contract                                  |
| ------------------------------------- | ----------------------------------------- |
| Cash, price, equity                   | Integer cents; fields use `_cents`        |
| P&L                                   | Signed integer cents; fields use `_cents` |
| Quantity                              | Whole shares, `u64`                       |
| Tick, slot, counters                  | Unsigned integers                         |
| Timestamp                             | SDK timestamp type                        |
| Duration                              | Integer microseconds; fields use `_us`    |
| Percentages and configured thresholds | Integer basis points; fields use `_bps`   |

Preserve 64-bit integer values through the frontend, using the SDK's integer representation. Convert to charting numbers only after an explicit range check. Arithmetic and any narrowing conversion must be checked.

### Private state and caller-scoped views

Keep these tables private:

```text
ActorState
HumanTrader
PendingHumanOrder
HumanOrderReceipt
RuntimeConfig
AdminAllowlist
DetailedBenchmarkReceipts
```

`TickReceipt` rows in section 14 are the records retained in private `DetailedBenchmarkReceipts`; benchmark readers require authorized access. Scheduler/control state and grant accounting are private too.

Expose only the current human's information through:

```text
my_trader
my_pending_order
my_recent_fills
```

These views derive identity from the authenticated caller and use indexed lookups. They must not accept an arbitrary identity from the browser. Choosing a subscription for one's own row is not access control. SpacetimeDB supports exposing private-table data through caller-filtered views. [Table permissions](https://spacetimedb.com/docs/tables/access-permissions/), [views](https://spacetimedb.com/docs/functions/views/).

### Public observer surfaces

Separate public presentation data from private authoritative actors and human accounts.

`MarketState` contains at least:

```text
logical_tick
epoch
price_cents
previous_traded_price_cents
matched_share_volume
volatility_bps
actor_count
active_actor_count
registered_human_trader_count
connected_identity_count

cumulative_actor_steps
cumulative_policy_evaluations
cumulative_actor_rows_updated
cumulative_orders_submitted
cumulative_orders_filled
cumulative_matched_share_volume
rate_window_us
rate_window_started_at
rate_window_ended_at
chaos_active
```

Publish cumulative activity counters and document the configured rate window. Compute displayed rates from counter deltas divided by **actual elapsed time**. Twenty completed ticks cannot be assumed to equal one elapsed second. Define whether each rate includes autonomous actors, humans, or both.

`PricePoint` carries `logical_tick`, `recorded_at`, `price_cents`, and `matched_share_volume`. Public activity carries an ID, tick, timestamp, participant type/public identifier, event kind, side where relevant, quantity, and price in cents for fills. Wipeout activity uses `WIPED — DRAWDOWN LIMIT`, signed lifetime P&L, and a wipeout count; it must not imply completed share liquidation before it happens.

`NewsEvent` carries an ID, headline, direction, `severity_bps`, `confidence_bps`, `start_tick`, and `end_tick`. A public actor sample may expose limited presentation fields for 64 actors without making the full `ActorState` table queryable.

### Retention limits

| Surface                | Retention                                    |
| ---------------------- | -------------------------------------------- |
| Price history          | Last 3,600 ticks                             |
| Public activity feed   | Last 500 entries; at most 20 new entries/sec |
| News                   | Last 16 events                               |
| Public actor sample    | 64 actors                                    |
| Per-human fill history | Last 32 fills                                |
| Benchmark summaries    | Last 20 results                              |
| Detailed tick receipts | Last 8,192 ticks per retained run            |

The activity feed is sampled presentation data. Its size must never compute actual trading throughput. A separate unbounded liquidation feed must not bypass these limits.

Use ordinary bounded tables when reconnecting clients need history. Transient event tables exist only within their originating transaction and are not interchangeable with retained feeds or benchmark evidence. [Event tables](https://spacetimedb.com/docs/tables/event-tables/).

### `BenchmarkResult`

The public headline record contains at minimum:

```text
id
status                    // RUNNING | PASSED | FAILED | INCONCLUSIVE
environment               // LOCAL | MAINCLOUD
workload_profile
actor_count
tick_interval_us
bucket_count
warmup_seconds
measurement_seconds
repeat_count
subscriber_count
offered_human_orders_per_second
committed_actor_updates
skipped_application_slots
start_lateness_p99_us
configuration_hash
build_hash
completed_at              // SDK timestamp; absent while running
```

A passed capacity result must satisfy the fixed qualification profile and all three fresh confirmations. Preserve per-run evidence behind the summary. The frontend selects a qualified result for the named environment/profile; it does not manufacture capacity from `MarketState.actor_count`.

Commit generated bindings or generate them reproducibly in CI, and make CI detect schema/binding drift. The scaffold commits its generated bindings. Chace owns schema semantics; Kaleb owns presentation; breaking changes require agreement from both.

---

## 13. Reducers and authorization

Public human surface:

```text
enter_market()
place_order(client_order_id, side, quantity, limit_price_cents)
```

Admin-authorized surface:

```text
trigger_chaos(...)
set_actor_population(...)
reset_market(...)
publish_benchmark_result(...)
benchmark_step(...)          // optional; refuses while scheduled simulation is enabled
```

Scheduler-only wrapper:

```text
simulation_tick(scheduled_tick_record)
```

Keep a scheduler-origin guard on the scheduled wrapper as defense in depth. Any manual benchmark-step wrapper must require admin authorization and refuse to operate while scheduled simulation is enabled. Normal viewers and human traders must not advance ticks, reset the world, change population, publish benchmark results, or trigger CHAOS.

The 2.0 migration guide describes scheduled functions as private by default, with manual calls available to owners and collaborators. The Rust reducer reference still recommends a caller-origin check. Resolve observed access behavior against the exact deployed stack and acceptance tests in section 19 rather than guessing which documentation page wins. [Migration guide](https://spacetimedb.com/docs/upgrade/#scheduled-functions-are-now-private), [Rust reducer reference](https://docs.rs/spacetimedb/latest/spacetimedb/attr.reducer.html#restricting-scheduled-reducers).

Use the chosen 2.x client API's per-call reducer results and explicit event tables for transient cross-client notifications. Do not use old global reducer-completion callback examples. Retained tick/fill evidence remains in ordinary tables. [Client migration](https://spacetimedb.com/docs/upgrade/#reducer-callbacks).

---

## 14. Benchmark evidence and qualification

### One public headline

> **Verified capacity: N persistent actors @ 20 Hz**

This is the largest population actually tested successfully under a named fixed workload and environment. It is not a universal upper bound on SpacetimeDB, and it is not a claim about execution duration.

All persistent actors receive a row update once per completed 20-tick logical epoch, including passing, exiting, and cooling-down actors. Population setup happens before the run; resizing or resetting during measurement invalidates it.

### Fixed qualification workload

| Parameter    | Qualification setting                                       |
| ------------ | ----------------------------------------------------------- |
| Tick target  | 20 Hz; `tick_interval_us = 50,000`                          |
| Buckets      | 20; every actor stepped once per logical epoch              |
| Warm-up      | 30 seconds                                                  |
| Measurement  | 180 seconds                                                 |
| Confirmation | Three fresh runs at the final candidate population          |
| Randomness   | Explicit seed and versioned policy configuration            |
| Viewer load  | 10 connected clients using the production subscription set  |
| Human load   | Five offered orders/sec total, using a deterministic script |
| Read mode    | Confirmed reads                                             |
| Environment  | Record local and Maincloud separately                       |

Freeze and hash the complete workload configuration: population/strategy generator, seed, policy rules, actor cadence, retention/subscription sets, deterministic human script, and shock configuration. Record offered orders separately from accepted orders and actual fills. Do not reduce load when the database slows and continue claiming the same profile.

### Committed tick receipts

The transaction that updates actors and settles the auction inserts one `TickReceipt` per successful tick:

```text
run_id
intended_slot
logical_tick
intended_at
invoked_at
actor_steps
policy_evaluations
actor_rows_updated
orders_submitted
orders_filled
matched_share_volume
```

`actor_steps` counts every due actor; `policy_evaluations` counts normal active-policy evaluations. `orders_filled` counts orders with a nonzero fill, and `matched_share_volume` counts transferred shares once. Retain the last 8,192 receipts per retained run, enough for the standard warm-up and measurement window, with per-bucket coverage evidence tied to the same run.

The Rust harness validates receipts, intended deadlines, logical/slot sequences, and per-bucket row-update coverage rather than merely counting callback arrivals. Missing, duplicate, or reduced workload must remain visible; aggregate counts alone cannot establish that every actor was updated.

Use **confirmed reads** for the measurement connection and verify the setting on the tested stack. The 2.0 migration guide says updates wait for durability confirmation. Receipt arrival still includes delivery latency and is not a server execution timer. [Confirmed reads](https://spacetimedb.com/docs/upgrade/#confirmed-reads-enabled-by-default).

### Qualification gate

Every confirmation run must establish:

- Zero skipped application slots.
- Complete actor-update coverage for each measured logical epoch/bucket.
- Zero reducer failures.
- P99 start lateness **strictly below 50,000 microseconds**.
- The offered workload and viewer load remained fixed.
- Achieved committed throughput, with no growing schedule debt.

Use the preassigned timeline in section 5. Never floor invocation time to derive the deadline or re-anchor after delays. Record start lateness separately from client delivery latency and reducer-call RTT.

Report run status as `RUNNING`, `PASSED`, `FAILED`, or `INCONCLUSIVE`. Established gate violations fail the run. A client disconnect or missing evidence makes the run inconclusive, not automatic proof that the database saturated. An inconclusive run cannot qualify the headline.

Repeat the final candidate three times with fresh initialized populations under the same versioned configuration. Publish the qualified result backed by all three runs, not the best lucky run. Preserve individual run evidence and environment/build metadata.

This is a **schedule-adherence qualification**. Do not publish “P99 execution time below 50 ms” unless execution duration is measured using a validated host-side source. Exact host execution duration is optional; `ctx.timestamp` cannot supply it.

### Benchmark details

The details drawer and methodology retain intended deadlines, start-lateness distribution, skipped slots, schedule debt, committed actor steps/row updates, policy evaluations, submitted/filled orders, matched share volume, reducer failures, observed delivery latency/RTT, connection health, configuration/build hashes, repeat evidence, and resource/energy metrics where available. Diagnostic client timings are labeled as client timings.

Publish a documented rate window using actual elapsed time. Neither public feed sampling nor callback counts supply trading or actor-update throughput.

---

## 15. Benchmark profiles

At minimum, qualify **NORMAL** and **CHAOS** profiles. They use the same population, cadence, seed, policies, viewer subscriptions, human order script, warm-up, measurement, read mode, and confirmation settings. The only difference is a fixed, versioned shock introduced at a predetermined intended slot in CHAOS.

The base actor-write workload remains `N` updates per completed epoch in both profiles. Record the increase in order participation, auction clearing, settlement, lifecycle transitions, and additional persistent records rather than assuming the shock changes the number of baseline actor writes.

Keep one primary headline: **Verified capacity: N persistent actors @ 20 Hz**, backed by the selected qualified environment/profile. Profile comparisons and the three fresh confirmation runs belong in Benchmark details. Local results cannot stand in for Maincloud qualification.

---

## 16. Production deployment

### Primary

```text
Vercel
  │
  │ React client
  ▼
SpacetimeDB Maincloud
  │
  └── Rust One Market module
```

Maincloud is the canonical production/shared world. Record its observed runtime version and qualify it separately from the local Docker environment.

Maincloud Pro is acceptable project spend.

### Offline fallback

```text
localhost frontend
        ↓
Dockerized local SpacetimeDB
        ↓
same Rust module
```

No dependency on venue Wi-Fi for the emergency demo.

The public Maincloud deployment remains the canonical benchmark/demo target.

---

## 17. Monorepo

Target layout; runtime files and benchmark documents are added as their milestones are implemented:

```text
one-market/
│
├── apps/
│   └── web/                    # Kaleb
│       ├── src/
│       └── ...
│
├── crates/
│   ├── spacetime/              # Chace
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── actor.rs
│   │   │   ├── policy.rs
│   │   │   ├── market.rs
│   │   │   ├── scheduler.rs
│   │   │   ├── chaos.rs
│   │   │   └── metrics.rs
│   │   └── Cargo.toml
│   │
│   └── benchmark/              # Chace
│       ├── src/
│       └── Cargo.toml
│
├── packages/
│   └── bindings/               # generated Spacetime TS bindings
│
├── infra/
│   ├── docker/
│   └── docker-compose.yml
│
├── scripts/
│   ├── local-up
│   ├── generate-bindings
│   ├── publish-maincloud
│   └── benchmark
│
├── docs/
│   ├── versions.md
│   └── benchmark-methodology.md
│
├── README.md
├── CONTRIBUTING.md
├── SPEC.md
└── AGENTS.md
```

---

## 18. Ownership

| Area                          | Owner                                                 |
| ----------------------------- | ----------------------------------------------------- |
| Rust module                   | **Chace**                                             |
| Actor scheduler               | **Chace**                                             |
| Actor policies                | **Chace**                                             |
| Market clearing               | **Chace**                                             |
| Persistence/schema internals  | **Chace**                                             |
| Benchmark harness             | **Chace**                                             |
| Maincloud                     | **Chace**                                             |
| React/frontend                | **Kaleb**                                             |
| Visualization                 | **Kaleb**                                             |
| Responsive/mobile             | **Kaleb**                                             |
| Vercel                        | **Kaleb**                                             |
| Client subscription lifecycle | **Kaleb**                                             |
| Demo visual hierarchy         | **Kaleb**                                             |
| Pitch                         | **Kaleb lead**                                        |
| Schema/interface contract     | **Chace owns schema; both agree on breaking changes** |
| Final demo sequence           | **Shared**                                            |

> **Chace owns the schema and runtime below the generated bindings. Kaleb owns presentation above them.**

Breaking changes require both owners to agree; CI detects binding drift.

---

## 19. Compatibility gate and first integration milestone

### Version record

Before the first v0.2 integration milestone, Chace produces `docs/versions.md` with:

```text
SpacetimeDB CLI:
Local runtime image tag + digest:
Rust module SDK:
Rust client SDK:
TypeScript client SDK:
Rust toolchain:
Generated-bindings schema/build hash:
Observed Maincloud version/build, where exposed:
```

Use exact tested dependency versions and committed lockfiles. Record the local image digest in addition to its tag. Do not assume the managed Maincloud runtime can be pinned; record its observed version/build where exposed, or explicitly record that it is unavailable.

### Acceptance checks

Against the exact local and deployed stacks, establish that an ordinary anonymous client cannot:

- Advance ticks through either scheduled or manual wrappers.
- Reset the simulation or change population.
- Publish benchmark results or trigger CHAOS.
- Read another human's private trader, pending order, or fill history, including through caller-scoped views.

Also verify that scheduler-origin calls succeed, the optional manual-step wrapper is admin-only and refuses while scheduled simulation is enabled, confirmed reads behave as configured, and the chosen client SDK uses per-call results rather than old global callbacks. Document observed behavior instead of choosing between conflicting documentation descriptions.

### Integration milestone

The existing scaffold establishes the basic connection with a persistent tick, static price, actor count, one interval schedule, public ping, and two synchronized browsers. That proof does not establish v0.2 benchmark timing or access-control compatibility.

For the v0.2 milestone, implement the explicit absolute-time slot schedule, typed market contract, caller-scoped views, and authorized reducer boundary. Regenerate bindings and verify two browsers observe the same shared market while each human sees only its own account state.

Freeze the agreed client contract, then split runtime and presentation work. A schema change must carry regenerated bindings and coordinated frontend changes.

---

## 20. Build order

### P0 — Skeleton and compatibility

- Monorepo, Docker, Rust module, shared clock, generated bindings, frontend subscription.
- Exact version/build record and local/deployed compatibility acceptance checks.
- Absolute-time intended slots, scheduler guard, and frozen v0.2 client contract.

### P1 — Market and lifecycle

- Persistent actors, 20 buckets, deterministic seeded policies, BUY/SELL/PASS.
- Uniform-price auction, real counterparties, checked arithmetic, conservation invariants.
- Drawdown exits, actual share liquidation, cooldown, recorded recapitalization grants.
- Every due actor persists an update in every state.

### P2 — Benchmark harness and exploratory scale

- Atomic tick receipts, per-bucket coverage, confirmed reads, deadline/debt evidence.
- Exploratory populations: 10k, 50k, 100k, 250k, 500k, 1M+.
- Find the measured degradation knee without presenting exploratory runs as qualified capacity.

### P3 — Human participation

- One identity-scoped trader, reservations, idempotent orders, server-side limits.
- Caller-scoped views, bounded fills/activity, synchronized browser validation.
- Deterministic human load and 10 production-subscription viewers for qualification.

### P4 — CHAOS

- Fixed versioned news shock and responsive strategy divergence.
- Actual settlements and drawdown stop-outs, sampled kill feed.
- Measure additional auction/settlement/lifecycle work; allow frozen-market outcomes.

### P5 — Production and final qualification

- Maincloud, Vercel, public URL, local fallback.
- Full fixed-workload NORMAL/CHAOS qualification, three fresh runs per final candidate.
- Authorized publication of environment-specific benchmark results.

### P6 — Polish

- Verified capacity headline, Benchmark details, mobile controls, pitch.
- Backup recorded demo.

---

## 21. Explicit non-goals

Do **not** burn time on:

- conventional account-registration flows (server identity checks and authorization remain required),
- real stocks,
- real financial data,
- LLM agents,
- CNNs,
- RL training,
- multiple assets,
- options,
- realistic exchange regulation,
- Kubernetes,
- Kafka,
- Redis,
- microservices,
- full historical trade archival,
- sophisticated portfolio management,
- realistic finance for its own sake.

The difficult problem is already:

> **How many persistent stateful actors can this runtime qualify at 20 Hz under the fixed workload?**

---

## 22. Demo definition of done

A judge should be able to:

1. Open the public site on their phone and see the same live market as the laptop.
2. See the persistent actor count, distinct connected identities, and actual filled-order rate.
3. Enter with a synthetic bankroll and place a buy or sell with a visible slippage allowance.
4. See their own acceptance/fill status and the shared effects of actual settlement.
5. See **Verified capacity: N persistent actors @ 20 Hz** from a qualified result.
6. Watch an admin trigger CHAOS and observe policies, auctions, fills, and drawdown stop-outs respond while clients remain synchronized.

A crash is not guaranteed. If sellers have no buyers, the demo must honestly show a frozen price and incomplete exits. The public experience stays simple: **one market, a huge actor count, join from your phone, place a trade, then watch CHAOS hit.**

Benchmark details and the Rust harness explain the measured workload, committed evidence, three confirmations, and named environment behind the headline.

**One Market: One Million** is unlocked only when the deployed benchmark qualifies at least 1,000,000 persistent actors under that contract.

### Implementation parameters still to freeze

The v0.2 rules above resolve the core contract gaps. Before implementing the affected runtime paths, version and record the remaining configuration choices:

- Numeric minimum permitted price, human order-size/rate limits, and the visible slippage default.
- Concrete policy/sizing/limit-price rules, generator/seed, and fixed CHAOS parameters/slot.
- Activity rate-window length and deterministic sampling/rate-limit rules.
- Client-order-ID type and deduplication retention so pruning recent fills cannot permit duplicate orders.
- Number of retained detailed benchmark runs and the precise missed-slot/debt recording and recovery policy.

These parameters must preserve the auction, lifecycle, access-control, retention, and qualification requirements above. They do not require adding a realistic exchange or changing the product thesis.
