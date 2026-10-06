# Maincloud: $5k actor reset and bounded 4 Hz observation

Production is **paused at tick 710**, with 1M ACTIVE actors, price $95.48, and
zero tick/stop schedules. The server stopped the authorized 180-second session
itself. No external safety pause was needed. A later all-actor audit confirmed
the same paused tick at **2026-10-04 14:50:21 UTC**.

## Source and deployment

- Performance PR [#10](https://github.com/nkuhanas/one-market/pull/10) merged
  first as `f1ff0e8017e74d38ccc14337f65eb27e58fa9f3f`.
- 4 Hz/public CHAOS/$5k PR [#12](https://github.com/nkuhanas/one-market/pull/12)
  merged as `9d90267e794803bb9c5ee6d675019fce15fd30af`. Both PR-head CI runs
  and post-merge main CI passed. Unrelated frontend PR #11 was not merged by
  this rollout; it landed independently afterward and is preserved in main.
- Regular WASM SHA-256:
  `9d7b545617c0e446c87a1c1d9dd12be170d9f5fe44b3779122dfde1842f3ae94`.
- Configuration BLAKE3:
  `e7f48d1418c02264bf27047c6211c73ad79d99c68044e1ea36d53eccc1fd547f`.
- Run 5 workload hash:
  `b2629bd0d66debf8cb428a439ce7fe0a7c9fa651f1e70d6b5fcf8a3a290e8a5c`.
- Database: `one-market-100k-20261004-035212`. The name is historical;
  population is 1,000,000, seed 20261003. Identity:
  `c200e95eb69477bcf73f4c84aa7a9828dd8ccd623978bef401244483771e7739`.

Publication used `--delete-data=never`, followed by the separately authorized
owner reset and bounded 500-row reset/initialization reducers. The reset removed
the old 1M actors, one human account, one pending order and world presentation
history. No full restorable actor/account backup was made. Historical artifacts,
all four old FAILED run records and their receipts, and durable order-ID
watermarks were retained; old evidence hashes were checked before and after.
No actor migration, automatic reset, hosting-tier change or production CHAOS
test was used.

## Clean initialization

The [initialization audit](initialization-audit.json) verified every actor's
financial/lifecycle fields and exact ID/bucket coverage before any tick:

- $2,500 cash +25 shares at $100 = **$5,000 total per actor**.
- Initial/marked/per-life equity 500,000 cents; zero grants, P&L, fills,
  wipeouts and prior updates; all actors ACTIVE in the compact representation.
- Exactly **25,000,000 shares** and **250,000,000,000 cash cents** ($2.5B).
- READY, tick 0, disabled, 4 Hz selected, no scheduled ticks or stops.

Humans retain their independent $100,000 bankroll. Fully liquidated actor
cooldowns top up cash to $5,000; inventory-retaining revival targets $5,000
marked equity with the reduced actor/world budgets. Local integration and
unit tests exercise these paths; this live observation did not trigger recap.

## Subsequent 180-second session

The user explicitly amended the initial no-resume instruction after reset
began, authorizing one approximately three-minute session once READY. The
owner called `start_timed_run("NORMAL", wasm_sha256, 180)` only after the
initialization audit. The start and durable deadline were atomic.

- Origin: **2026-10-04 14:44:19.945872 UTC**.
- Stop deadline: **2026-10-04 14:47:19.945872 UTC**.
- First observed paused: **14:47:20.381 UTC**. No tick began at/after the deadline.
- Three connected identities observed; no synthetic viewers/orders or warm-up.
  One was the passive deployment-verification browser. This is not the prescribed
  three-viewer-plus-order-generator qualification load.

| Observation | Result |
| --- | --- |
| Committed ticks / effective rate | 710 / 3.9444 Hz |
| Missed application slots | 9 |
| p99 / worst tick-start gap | 307.554 / 920.153 ms |
| p99 start lateness | 160.010 ms |
| Persistent actor updates | 35,499,626 |
| Total matched shares | 50,897,392 |
| Price range including initial / final | $95.27–$100.00 / $95.48 |
| Penny-floor ticks / zero-volume ticks | 0 / 0 |
| Final ACTIVE actors / actors with any wipeout | 1,000,000 / 0 |
| Recap/revival grants / recovery episodes | 0 / 0 |

The first tick is due one interval after origin and ticks cannot start at the
deadline: 719 pre-deadline slots were available, with nine skipped. Run 5
correctly remains **FAILED: missed application slots**, not a capacity result.
Near-target average throughput does not remove the long stalls or demonstrate
long-term market stability. Endowment, cadence and build all differ from prior
5 Hz probes; this is not a controlled before/after optimization comparison.

The [post-run audit](postrun-audit.json) checked all 1M last-step/status rows,
summed every actor's actual cash and shares, and confirmed conservation and a
stable paused server state. Total cash and share supply are unchanged.

## Frontend and evidence

Vercel production deployment `dpl_7ioBjPR6jTqXNFrDixynTXdiUuui` was READY for
merged commit `9d90267`. A Playwright skill-guided browser check of
<https://www.one-market.tech> observed 1M actors, 4 Hz, $5,000 initial sampled
equity, advancing live ticks and final stationary tick 710/$95.48. It did not
enter the market, place orders or activate CHAOS. The only console error was
the existing `/favicon.ico` 404. No frontend connection settings changed.

[summary.json](summary.json) records aggregate results. [ticks.csv](ticks.csv)
retains all 710 tick receipts' timing, coverage counters, volume and joined
prices, without private actor/account rows. Complete raw SQL receipts/prices,
operator control snapshots and screenshots remain in ignored local evidence.
Their SHA-256 values are:

- Raw receipts: `767162de54183d377f953cbad1e126ad357f9f714aae0727924afea5e4f12687`.
- Raw prices: `ea1bef761f5363eabcd6ee6e24e5a003ca209bcaa2858f7f4ee65d9f08358ca2`.

Local verification before merge: `check` (13 JS and 46 Rust tests, three
explicitly ignored), 46 backend tests, four browser tests, and the old-WASM
upgrade/restart/compact-storage/timed-stop gate passed. Public CHAOS was tested
with non-admin identities locally, not by disturbing this production session.
