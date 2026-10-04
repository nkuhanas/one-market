//! Deterministic model regressions, NOT a database or capacity benchmark.
//! Use the production policy/auction/lifecycle; only the row store and clock
//! are replaced. Real-runtime smoke and exploratory runs verify persistence.
use crate::{lifecycle, schema::*};
use one_market_core::{
    auction::{self, Order},
    bucket,
    config::{config, Config},
    equity, mix,
    policy::{self, Signals, Weights},
};

struct World {
    c: Config,
    actors: Vec<ActorState>,
    buckets: Vec<Vec<usize>>,
    price: u64,
    previous: u64,
    imbalance: i64,
    cash: u128,
    shares: u128,
    grants: u128,
    floor_ticks: u64,
    longest_floor: u64,
    floor_streak: u64,
    volume: u64,
    min: u64,
    max: u64,
}

impl World {
    fn new(seed: u64, population: u64) -> Self {
        let c = Config { seed, ..config() };
        let mut actors = vec![];
        let mut buckets = vec![vec![]; 20];
        for id in 1..=population {
            let w = policy::weights(seed, id);
            let marked = equity(c.actor_cash_cents, c.actor_shares, c.initial_price_cents).unwrap();
            buckets[usize::from(bucket(id))].push(actors.len());
            actors.push(ActorState {
                actor_id: id,
                bucket: bucket(id),
                cash_cents: c.actor_cash_cents,
                shares: c.actor_shares,
                marked_equity_cents: marked,
                initial_endowment_value_cents: marked,
                life_peak_equity_cents: marked,
                cumulative_recapitalization_grants_cents: 0,
                momentum_weight: w.momentum,
                mean_reversion_weight: w.reversion,
                contrarian_weight: w.contrarian,
                news_weight: w.news,
                risk_tolerance_bps: w.risk,
                conviction_threshold_bps: w.conviction,
                last_step_tick: None.into(),
                status: ActorStatus::Active,
                cooldown_started_tick: None.into(),
                lifetime_pnl_cents: 0,
                wipeout_count: 0,
                filled_order_count: 0,
            });
        }
        Self {
            price: c.initial_price_cents,
            previous: c.initial_price_cents,
            cash: u128::from(c.actor_cash_cents) * u128::from(population),
            shares: u128::from(c.actor_shares) * u128::from(population),
            c,
            actors,
            buckets,
            imbalance: 0,
            grants: 0,
            floor_ticks: 0,
            longest_floor: 0,
            floor_streak: 0,
            volume: 0,
            min: u64::MAX,
            max: 0,
        }
    }

    fn step(&mut self, tick: u64, news_bps: i64) {
        let s = Signals {
            momentum_bps: ((i128::from(self.price) - i128::from(self.previous)) * 10_000
                / i128::from(self.previous)) as i64,
            reversion_bps: ((i128::from(self.c.initial_price_cents) - i128::from(self.price))
                * 10_000
                / i128::from(self.price)) as i64,
            imbalance_bps: self.imbalance,
            news_bps,
        };
        let mut orders = vec![];
        let mut origins = vec![];
        let due = &self.buckets[(tick % 20) as usize];
        for &i in due {
            let a = &mut self.actors[i];
            assert_eq!(a.last_step_tick.get(), tick.checked_sub(20));
            let (grant, transition) = lifecycle::prepare(a, self.price, tick, &self.c).unwrap();
            self.grants += u128::from(grant);
            let intent = if a.status == ActorStatus::Exiting {
                policy::liquidation(a.shares, self.price, &self.c).unwrap()
            } else if a.status == ActorStatus::Active && transition != Some("RECAPITALIZED") {
                policy::decide(
                    Weights {
                        momentum: a.momentum_weight,
                        reversion: a.mean_reversion_weight,
                        contrarian: a.contrarian_weight,
                        news: a.news_weight,
                        conviction: a.conviction_threshold_bps,
                        risk: a.risk_tolerance_bps,
                    },
                    s,
                    self.c.seed,
                    a.actor_id,
                    tick,
                    a.cash_cents,
                    a.shares,
                    self.price,
                    &self.c,
                )
                .unwrap()
            } else {
                None
            };
            if let Some((buy, quantity, limit)) = intent {
                orders.push(Order {
                    key: a.actor_id * 2,
                    buy,
                    quantity,
                    limit,
                });
                origins.push(i);
            }
        }
        let result = auction::clear(&orders, self.price, mix(self.c.seed ^ tick)).unwrap();
        for (oi, &i) in origins.iter().enumerate() {
            let a = &mut self.actors[i];
            (a.cash_cents, a.shares) = policy::settle(
                a.cash_cents,
                a.shares,
                orders[oi].buy,
                result.fills[oi],
                result.price,
            )
            .unwrap();
            if result.fills[oi] > 0 {
                a.filled_order_count += 1;
            }
        }
        for &i in due {
            lifecycle::finish(&mut self.actors[i], tick, result.price).unwrap();
        }
        let buys: u128 = orders
            .iter()
            .filter(|o| o.buy)
            .map(|o| u128::from(o.quantity))
            .sum();
        let sells: u128 = orders
            .iter()
            .filter(|o| !o.buy)
            .map(|o| u128::from(o.quantity))
            .sum();
        self.imbalance = if buys + sells == 0 {
            0
        } else {
            ((buys as i128 - sells as i128) * 10_000 / (buys + sells) as i128) as i64
        };
        self.previous = self.price;
        self.price = result.price;
        self.volume += result.volume;
        self.min = self.min.min(self.price);
        self.max = self.max.max(self.price);
        if self.price == self.c.min_price_cents {
            self.floor_ticks += 1;
            self.floor_streak += 1;
            self.longest_floor = self.longest_floor.max(self.floor_streak);
        } else {
            self.floor_streak = 0;
        }
    }

    fn audit(&self) {
        assert_eq!(
            self.actors
                .iter()
                .map(|a| u128::from(a.cash_cents))
                .sum::<u128>(),
            self.cash + self.grants
        );
        assert_eq!(
            self.actors
                .iter()
                .map(|a| u128::from(a.shares))
                .sum::<u128>(),
            self.shares
        );
        assert_eq!(
            self.actors
                .iter()
                .map(|a| u128::from(a.cumulative_recapitalization_grants_cents))
                .sum::<u128>(),
            self.grants
        );
        assert!(self
            .actors
            .iter()
            .all(|a| a.status != ActorStatus::Cooldown || a.shares == 0));
    }

    fn active(&self) -> usize {
        self.actors
            .iter()
            .filter(|a| a.status == ActorStatus::Active)
            .count()
    }

    fn report(&self, label: &str) {
        spacetimedb::log::info!("{label}: seed={} min={} max={} final={} active={} floor_ticks={} longest_floor={} volume={} grants={}",
            self.c.seed, self.min, self.max, self.price, self.active(), self.floor_ticks,
            self.longest_floor, self.volume, self.grants);
    }
}

#[test]
fn normal_and_repeated_chaos_remain_live_for_forty_minutes() {
    for seed in [20261003, 42, 987654] {
        for chaos in [false, true] {
            let mut w = World::new(seed, 200);
            for tick in 0..48_000 {
                // Same 60-second shock duration, repeated after 20 minutes.
                let news =
                    if chaos && ((1199..2399).contains(&tick) || (25199..26399).contains(&tick)) {
                        -8000
                    } else {
                        0
                    };
                w.step(tick, news);
                if tick % 200 == 0 {
                    w.audit();
                }
            }
            w.audit();
            w.report(if chaos { "CHAOS soak" } else { "NORMAL soak" });
            assert_eq!(w.floor_ticks, 0);
            assert!(w.active() >= 150, "at least 75% active after recovery");
            assert!(w.price > 100 && w.volume > 0);
        }
    }
}

#[test]
fn fully_exiting_buckets_do_not_fabricate_buyers_or_recapitalizations() {
    let mut w = World::new(20261003, 200);
    w.price = 1;
    w.previous = 1;
    for (i, a) in w.actors.iter_mut().enumerate() {
        // Same assets/cash, only a distressed mark and lifecycle fixture.
        if i >= 7 {
            a.status = ActorStatus::Exiting;
            a.wipeout_count = 1;
        }
    }
    for tick in 0..48_000 {
        w.step(tick, if tick < 1200 { -8000 } else { 0 });
        if tick % 200 == 0 {
            w.audit();
        }
    }
    w.audit();
    w.report("7-survivor penny recovery");
    assert!(w.price > 100);
    // Bucket-local one-tick auctions cannot conjure counterparties in a bucket
    // that started with no ACTIVE actors. Preserve this counterexample rather
    // than promising universal recovery from an arbitrary old-world state.
    for b in &w.buckets {
        if b.iter().all(|&i| i >= 7) {
            for &i in b {
                assert_eq!(w.actors[i].status, ActorStatus::Exiting);
                assert_eq!(w.actors[i].shares, w.c.actor_shares);
                assert_eq!(w.actors[i].cumulative_recapitalization_grants_cents, 0);
                assert!(w.actors[i].last_step_tick.get().unwrap() >= 47_980);
            }
        }
    }
    assert!(w.volume > 0);
    assert_eq!(w.floor_streak, 0);
}

#[test]
fn distressed_market_with_funded_buyers_in_each_bucket_recovers() {
    for seed in [20261003, 42, 987654] {
        let mut w = World::new(seed, 1000);
        w.price = 1;
        w.previous = 1;
        for b in &w.buckets {
            for &i in b.iter().skip(b.len().div_ceil(3)) {
                w.actors[i].status = ActorStatus::Exiting;
                w.actors[i].wipeout_count = 1;
            }
        }
        for tick in 0..24_000 {
            w.step(tick, if tick < 1200 { -8000 } else { 0 });
            if tick % 200 == 0 {
                w.audit();
            }
        }
        w.audit();
        w.report("funded penny recovery");
        assert!(w.price > 100);
        assert!(w.active() >= 750);
        assert!(w.grants > 0 && w.volume > 0);
        assert_eq!(w.floor_streak, 0);
    }
}
