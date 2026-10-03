Yeah. At this point I’d formalize it enough that both of you—and Codex—can treat this as the source of truth.

# One Market — Technical Spec v0.1

**Repository:** `one-market`  
**Product name:** **One Market**  
**Conditional branding:** **One Market: One Million** only if the deployed benchmark actually sustains ≥1,000,000 actors under the defined workload. No bullshit rounding up.

**Team**
- **Chace** — backend/runtime, SpacetimeDB, Rust, benchmarking, Maincloud
- **Kaleb** — frontend, UX, visualization, Vercel, pitch/demo presentation

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
- highly variable write density,
- and immediately understandable emergent behavior.

This is **not primarily a finance project**. It is a real-time actor-runtime and SpacetimeDB scalability experiment presented through a market people can understand instantly.

---

# 2. Headline experience

Anyone should be able to open the deployed site from anywhere and immediately observe **the same market**.

They see something roughly like:

```text
ONE MARKET

Live Actors                         487,500
Humans Online                            38
Current Price                         $72.41
Trades / sec                          18,293

Maximum Sustainable Actors @ 20 Hz   612,500

              [ LIVE PRICE GRAPH ]

RECENT ACTIVITY
#49102 BUY
#18291 LIQUIDATED
HUMAN 0x42AF BUY
#88201 SELL

                    [ ENTER MARKET ]
```

A visitor can:

1. observe the market anonymously,
2. enter with a synthetic bankroll,
3. buy or sell the same asset,
4. see their action propagate to all connected users,
5. watch autonomous agents react,
6. potentially get wrecked when CHAOS is triggered.

Humans and autonomous actors use the **same authoritative SpacetimeDB market state**.

---

# 3. Stack

| Component | Technology |
|---|---|
| Monorepo | Git |
| Backend/runtime | Rust |
| Database + authoritative state | SpacetimeDB |
| Production DB/runtime | SpacetimeDB Maincloud |
| Frontend | React + TypeScript + Vite assumed |
| Frontend deployment | Vercel |
| Local environment | Docker / Docker Compose |
| Benchmark harness | Rust |
| Client/server integration | Generated SpacetimeDB bindings |
| Public transport/sync | SpacetimeDB client subscriptions/reducers |

SpacetimeDB supports Rust modules and runs application logic inside the database rather than requiring a conventional API server. Local SpacetimeDB can also be run using the official Docker image, which makes the Docker fallback reasonable. :chatgpt-content-reference{index="0"}

---

# 4. High-level architecture

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

# 5. Simulation clock

## Base clock

**20 Hz global simulation**

```text
1 tick = 50 ms
20 ticks = 1 epoch
1 epoch = 1 second
```

SpacetimeDB scheduled reducers support interval execution and specifically skip missed interval executions rather than attempting to replay an accumulated backlog, which makes missed ticks useful saturation evidence. :chatgpt-content-reference{index="1"}

## Baseline actor scheduling

Every autonomous actor belongs to one of **20 epoch buckets**:

```text
bucket = deterministic_hash(agent_id) % 20
```

On tick `T`:

```text
active_bucket = T % 20
```

Only actors assigned to that bucket evaluate.

Therefore:

> **Every autonomous actor evaluates exactly once per one-second epoch.**

For `1,000,000` actors:

```text
1,000,000 persistent actors
÷ 20 buckets
=
~50,000 actor evaluations per tick

20 ticks/sec
=
1,000,000 actor evaluations/sec
```

This is the initial standardized benchmark workload.

### Stretch

Later, selected policies may operate at faster cadence classes, but **the published headline benchmark must use a fixed scheduling profile** so the actor number cannot be gamed by changing evaluation frequency.

---

# 6. Actor model

Agents are intentionally cheap policy actors, **not LLM agents and not neural networks**.

Initial actor:

```rust
Agent {
    id,

    // Economic state
    cash,
    shares,
    net_worth,

    // Policy
    momentum_weight,
    mean_reversion_weight,
    contrarian_weight,
    news_weight,
    risk_tolerance,
    conviction_threshold,

    // Runtime
    bucket,
    last_eval_tick,
    status,

    // Persistent history
    lifetime_pnl,
    bankruptcies,
    trades,
}
```

Every actor receives a deterministic randomized strategy at initialization.

A seeded PRNG should make populations reproducible between benchmark runs.

## Policy output

Exactly three decisions:

```text
BUY
SELL
PASS
```

Policy conceptually computes:

\[
signal =
w_mM +
w_rR +
w_cC +
w_nN +
\epsilon
\]

where:

- `M` = momentum
- `R` = mean-reversion signal
- `C` = crowd/contrarian signal
- `N` = current news shock
- `ε` = deterministic actor-specific noise

Magnitude determines conviction/position sizing.

---

# 7. Persistent actor-state requirement

This is important.

**Actor state must actually live in SpacetimeDB.**

The benchmark must not secretly become:

```text
1,000,000 actors in a private Rust Vec
↓
write three aggregate values to SpacetimeDB
```

That defeats the experiment.

Permitted optimizations:

- bucketing,
- batching,
- indexes,
- compact row design,
- reduced allocations,
- efficient iteration,
- bounded event history,
- aggregate subscriptions,
- optimized data representation.

Not permitted for the headline benchmark:

- moving authoritative actor state outside SpacetimeDB,
- external native simulation services,
- pretending logical actors are DB actors when their state isn't persisted.

### Actor evaluation writes

When an actor's bucket executes, its persistent actor row should be materially updated.

At minimum:

```text
last_eval_tick
net_worth
runtime state
```

and if it acts:

```text
cash
shares
PnL-related state
trade count
etc.
```

Therefore all `N` autonomous actors incur persistent evaluation-state mutation over each epoch.

---

# 8. Market model

## MVP: one synthetic asset

No real companies.

Example symbol:

**`ONE`**

Starting state can be something like:

```text
Price: $100
Agent bankroll: $100,000
Human bankroll: $100,000
```

All money is synthetic.

## Clearing mechanism

Start with a **tick-batched market**, not a NASDAQ-grade continuous limit order book.

Each due actor produces:

```text
BUY(quantity)
SELL(quantity)
PASS
```

Human orders received during the tick enter the same next clearing cycle.

At the end of the tick:

```text
actor intents
+
human orders
        ↓
aggregate demand / supply
        ↓
market clearing
        ↓
new price
        ↓
portfolio settlement
        ↓
persistent actor/human updates
```

Price response should depend on net order imbalance and configurable market depth/liquidity.

The exact equation can evolve as long as:

- the same input state is reproducible,
- agent actions materially affect price,
- humans participate in the same mechanism,
- market behavior doesn't require hard-coded scripted crashes.

### Stretch goal

Actual order book / limit orders only **after the baseline system and benchmark work**.

---

# 9. Bankruptcy

Agents retain:

- identity,
- policy,
- lifetime statistics.

When insolvent:

```text
ACTIVE
↓
LIQUIDATED
↓
COOLDOWN
↓
RECAPITALIZED
↓
ACTIVE
```

Default cooldown:

**1 epoch / 20 ticks**, tunable.

Recapitalization resets current holdings but not strategy/history.

Example:

```text
☠ AGENT #418201 LIQUIDATED
Lifetime bankruptcies: 7
Lifetime P&L: -$381,291
```

That keeps the requested actor population stable while still allowing wipeouts to matter.

---

# 10. CHAOS

`CHAOS` is both:

1. a demonstration mechanic,
2. a pathological stress workload.

Admin-only.

When triggered, generate an obviously fictional scandal:

> **ONE Industries admits its lunar revenue division does not actually exist.**

Event:

```text
NewsEvent {
    headline,
    direction,
    severity,
    confidence,
    duration_ticks,
}
```

The event modifies agents' `news` signal.

**It must not directly hard-code a market crash.**

Instead:

```text
news shock
↓
individual policy evaluations
↓
more SELL / BUY decisions
↓
order imbalance
↓
price movement
↓
liquidations
↓
contrarian entry
↓
secondary behavior
```

That distinction matters.

The simulation creates the crash.

CHAOS simply changes the environment.

---

# 11. Human traders

A visitor does not need conventional account registration.

Each connected identity may create one lightweight human trader.

```text
HumanTrader {
    identity,
    cash,
    shares,
    pnl,
    created_at,
}
```

Humans can:

```text
BUY
SELL
```

No derivatives, shorting or leverage in MVP.

Server-side constraints:

- maximum order size,
- rate limiting,
- sufficient cash validation,
- sufficient share validation,
- one human trader per identity.

Human participation **does not count toward the autonomous actor benchmark number**.

UI explicitly separates:

```text
AUTONOMOUS ACTORS   812,500
HUMAN TRADERS            72
```

---

# 12. Public data contract

Kaleb should be able to build almost everything from a small stable outward-facing schema.

## `MarketState`

```text
tick
epoch
price
previous_price
volume
volatility

actor_count
active_actor_count
human_count

evaluations_per_second
actor_updates_per_second
orders_per_second
trades_per_second

chaos_active
```

## `PricePoint`

```text
tick
price
volume
```

Bounded history.

## `TradeEvent`

Recent/sample feed only.

```text
id
tick
participant_type
participant_id
side
quantity
price
```

## `LiquidationEvent`

```text
id
tick
agent_id
lifetime_pnl
bankruptcy_count
```

## `NewsEvent`

```text
id
headline
severity
start_tick
end_tick
```

## `HumanTrader`

Only the information required by the current identity/client.

---

# 13. Public reducers

Initial public surface:

```text
enter_market()
place_order(side, quantity)
```

Admin surface:

```text
trigger_chaos(...)
set_actor_population(...)
reset_market(...)
```

Internal:

```text
simulation_tick(...)
```

Scheduled reducers should reject external calls when intended to be scheduler-only; SpacetimeDB's docs explicitly note scheduled reducers remain callable by clients unless authorization is checked. :chatgpt-content-reference{index="2"}

---

# 14. Benchmark

## Headline metric

There should be **one number judges remember**:

# Maximum Sustainable Actors @ 20 Hz

Definition:

> Largest persistent autonomous population for which all actors are evaluated and their state persisted once per 20-tick epoch while SpacetimeDB continuously sustains the 20 Hz scheduler without missed ticks during the benchmark window.

### Standard run

Proposed:

```text
Warmup:       30 sec
Measurement: 180 sec
Tick rate:    20 Hz
Epoch:        20 ticks
Agent eval:   1 / epoch
```

A run fails sustainability if:

- any scheduled ticks are skipped,
- P99 scheduler start lateness exceeds one 50 ms tick interval,
- transaction/reducer failures occur,
- Maincloud resource/service limits invalidate the run.

The UI only needs:

```text
MAX SUSTAINABLE ACTORS
812,500

20 Hz · 0 skipped ticks
```

The deep measurements can exist behind a details drawer.

## Supporting diagnostics

Rust harness records:

- scheduling lateness,
- skipped ticks,
- reducer completion RTT,
- client-observed update interval,
- actor evaluations/sec,
- actor row writes/sec,
- transactions/sec,
- failures,
- Maincloud resource/energy behavior where available.

Do **not** use `ctx.timestamp` as an execution timer.

The purpose of these metrics is diagnosis, not cluttering the judge pitch.

---

# 15. Benchmark profiles

At minimum:

### Normal

Standard market conditions.

### CHAOS

Same actor count and scheduler profile with a severe news event producing far greater trading/liquidation activity.

The headline stays **Maximum Sustainable Actors @ 20 Hz**.

Chaos can provide a secondary statement:

```text
NORMAL CAPACITY       812,500
CHAOS CAPACITY        530,000
```

only if useful.

---

# 16. Production deployment

## Primary

```text
Vercel
  │
  │ React client
  ▼
SpacetimeDB Maincloud
  │
  └── Rust One Market module
```

Maincloud is the real production/shared world. Publishing Rust application modules there is a first-party deployment path. :chatgpt-content-reference{index="3"}

Maincloud Pro is acceptable project spend.

## Offline fallback

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

# 17. Monorepo

Recommended:

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
│   └── benchmark-methodology.md
│
├── README.md
└── AGENTS.md
```

---

# 18. Ownership

| Area | Owner |
|---|---|
| Rust module | **Chace** |
| Actor scheduler | **Chace** |
| Actor policies | **Chace** |
| Market clearing | **Chace** |
| Persistence/schema internals | **Chace** |
| Benchmark harness | **Chace** |
| Maincloud | **Chace** |
| React/frontend | **Kaleb** |
| Visualization | **Kaleb** |
| Responsive/mobile | **Kaleb** |
| Vercel | **Kaleb** |
| Client subscription lifecycle | **Kaleb** |
| Demo visual hierarchy | **Kaleb** |
| Pitch | **Kaleb lead** |
| Schema/interface contract | **Shared** |
| Final demo sequence | **Shared** |

The rule should basically be:

> **Chace owns everything below the generated bindings. Kaleb owns everything above them.**

That is an absurdly clean division.

---

# 19. First integration milestone

Do this **before either of you disappears into your respective caves**.

Backend:

```text
MarketState {
    tick,
    price,
    actor_count,
}
```

One scheduled tick.

One public reducer.

Frontend subscribes and sees live changes.

Then verify:

```text
Browser A
Browser B
      ↓
same SpacetimeDB
      ↓
both show synchronized price/tick
```

Once that succeeds, freeze the first client contract and split.

Kaleb can build the entire experience while your backend evolves from:

```text
actor_count = 100
```

into whatever Rust purgatory eventually produces 700k actors.

---

# 20. Build order

### P0 — Skeleton
- monorepo
- Docker
- Rust module
- scheduled 20 Hz tick
- generated TS bindings
- frontend subscription

### P1 — Market
- actors
- 20 buckets
- policy evaluation
- BUY/SELL/PASS
- clearing
- persistent actor updates

### P2 — Scale
- benchmark harness
- 10k
- 50k
- 100k
- 250k
- 500k
- 1M+
- find actual degradation knee

### P3 — Human participation
- anonymous human trader
- buy/sell
- synchronized feed
- browser-to-browser validation

### P4 — CHAOS
- news shock
- liquidation cascades
- kill feed
- responsive strategy divergence

### P5 — Production
- Maincloud Pro
- Vercel
- public URL
- local fallback
- benchmark production deployment

### P6 — Polish
- benchmark headline
- frontend theater
- pitch
- backup recorded demo

---

# 21. Explicit non-goals

Do **not** burn time on:

- authentication flows,
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

> **How many persisted stateful actors can we shove through this fucking runtime at 20 Hz?**

Do that.

---

# 22. Demo definition of done

A judge should be able to:

1. open the public site on their phone,
2. immediately see the same live market as your laptop,
3. see **N autonomous actors** operating,
4. enter the market,
5. buy something,
6. see their trade propagate everywhere,
7. see the validated **Maximum Sustainable Actors @ 20 Hz** result,
8. press/watch CHAOS,
9. watch the market implode organically,
10. see agents liquidated and contrarians enter while the system remains synchronized.

And if they ask:

> “How did you benchmark it?”

then you have the serious Rust harness and methodology underneath the flashy demo.

That’s the project.

**One Market** is the right name right now. **One Market: One Million** gets unlocked only when Chace's Rust hell actually prints the receipt.
