//! Deterministic model regressions, NOT a database or capacity benchmark.
//! Use the production policy/auction/lifecycle; only the row store and clock
//! are replaced. Real-runtime smoke and exploratory runs verify persistence.
use crate::{lifecycle, revival, schema::*};
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
    dynamics: MarketDynamics,
    health: Vec<BucketHealth>,
    recovery: Vec<Option<ActorRecovery>>,
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
            dynamics: revival::fresh(c.initial_price_cents),
            health: (0..20).map(revival::bucket_state).collect(),
            recovery: vec![None; population as usize],
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
        revival::advance_reference(&mut self.dynamics, self.c.seed, tick, &self.c).unwrap();
        let s = Signals {
            momentum_bps: ((i128::from(self.price) - i128::from(self.previous)) * 10_000
                / i128::from(self.previous)) as i64,
            reference_price_cents: self.dynamics.reference_price_cents,
            sentiment_bps: self.dynamics.sentiment_bps,
            imbalance_bps: self.imbalance,
            news_bps,
        };
        let mut orders = vec![];
        let mut origins = vec![];
        let due = &self.buckets[(tick % 20) as usize];
        let population = self.actors.len() as u64;
        for (rank, &i) in due.iter().enumerate() {
            let a = &mut self.actors[i];
            assert_eq!(a.last_step_tick.get(), tick.checked_sub(20));
            let was_active = a.status == ActorStatus::Active;
            let (mut grant, mut transition) =
                lifecycle::prepare(a, self.price, tick, &self.c).unwrap();
            if a.status == ActorStatus::Exiting {
                let record = self.recovery[i].get_or_insert(ActorRecovery {
                    actor_id: a.actor_id,
                    exit_started_tick: tick,
                    last_episode: 0,
                    grants_cents: 0,
                });
                if was_active {
                    record.exit_started_tick = tick;
                }
                if let Some(support) = revival::try_revive(
                    a,
                    record,
                    &mut self.dynamics,
                    rank,
                    tick,
                    self.price,
                    population,
                    &self.c,
                )
                .unwrap()
                {
                    grant += support;
                    transition = Some("REVIVED — INVENTORY RETAINED");
                }
            }
            self.grants += u128::from(grant);
            let intent = if a.status == ActorStatus::Exiting {
                policy::liquidation(a.shares, self.price, &self.c).unwrap()
            } else if a.status == ActorStatus::Active
                && transition != Some("RECAPITALIZED")
                && transition != Some("REVIVED — INVENTORY RETAINED")
            {
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
        let bucket_active = due
            .iter()
            .filter(|&&i| self.actors[i].status == ActorStatus::Active)
            .count() as u64;
        let bucket_population = due.len() as u64;
        let active = self.active() as u64;
        revival::observe(
            &mut self.dynamics,
            &mut self.health[(tick % 20) as usize],
            tick,
            result.price,
            result.volume,
            active,
            population,
            bucket_active,
            bucket_population,
            &self.c,
        )
        .unwrap();
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
        // This entire module is native-test-only; no stdout exists in production WASM.
        std::io::Write::write_fmt(&mut std::io::stdout(), format_args!("{label}: seed={} min={} max={} final={} active={} floor_ticks={} longest_floor={} volume={} grants={} revivals={} recovery_grants={} episodes={}\n",
            self.c.seed, self.min, self.max, self.price, self.active(), self.floor_ticks,
            self.longest_floor, self.volume, self.grants, self.dynamics.revived_actors,
            self.dynamics.total_grants_cents, self.dynamics.episode)).unwrap();
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
fn legacy_disabled_revival_preserves_the_dead_bucket_counterexample() {
    let mut w = World::new(20261003, 200);
    w.c.revival_enabled = false;
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
fn no_buyers_escape_after_distress_without_inventory_deletion_or_fake_fills() {
    let mut w = World::new(20261003, 200);
    w.price = 1;
    w.previous = 1;
    w.dynamics.reference_price_cents = 1;
    for a in &mut w.actors {
        a.status = ActorStatus::Exiting;
    }
    for tick in 0..600 {
        w.step(tick, 0);
        assert_eq!(w.volume, 0);
        assert_eq!(w.price, 1);
        assert_eq!(w.active(), 0);
        assert_eq!(w.grants, 0);
    }
    assert_eq!(w.dynamics.mode, "RECOVERY");
    let mut escaped = vec![false; w.actors.len()];
    for tick in 600..1020 {
        w.step(tick, 0);
        for (seen, actor) in escaped.iter_mut().zip(&w.actors) {
            *seen |= actor.status != ActorStatus::Exiting;
        }
    }
    w.audit();
    assert!(escaped.iter().all(|seen| *seen));
    assert!(w.dynamics.revived_actors > 0);
    // With only 25 shares, revived buyers can fully liquidate other actors
    // before their cohort is due. Both routes legitimately escape EXITING.
    for (a, record) in w.actors.iter().zip(&w.recovery) {
        assert!(record.as_ref().unwrap().last_episode == 1 || a.filled_order_count > 0);
    }
    assert!(w.active() > 0);
    // Eligibility and explicit grants are guaranteed, not a synthetic price rise.
    for tick in 1020..12_000 {
        w.step(tick, 0);
    }
    w.audit();
    w.report("all-exiting penny revival");
    assert!(w.volume > 0);
}

#[test]
fn revival_grants_are_capped_and_do_not_count_as_lifetime_profit() {
    let mut w = World::new(42, 2);
    w.c.revival_actor_cap_cents = 100;
    w.c.revival_episode_budget_bps = 20; // 2,000 cents for this world
    w.c.revival_total_budget_bps = 20;
    w.dynamics.mode = "RECOVERY".into();
    w.dynamics.episode = 1;
    let a = &mut w.actors[0];
    a.status = ActorStatus::Exiting;
    let shares = a.shares;
    let mut record = ActorRecovery {
        actor_id: a.actor_id,
        exit_started_tick: 0,
        last_episode: 0,
        grants_cents: 0,
    };
    assert_eq!(
        revival::try_revive(a, &mut record, &mut w.dynamics, 0, 0, 1, 2, &w.c).unwrap(),
        None
    );
    // Rank 0's cohort at epoch 40; the minimum wait is already satisfied.
    assert_eq!(
        revival::try_revive(a, &mut record, &mut w.dynamics, 0, 800, 1, 2, &w.c).unwrap(),
        Some(100)
    );
    assert_eq!(a.shares, shares);
    assert_eq!(a.cash_cents, w.c.actor_cash_cents + 100);
    lifecycle::finish(a, 800, 1).unwrap();
    assert_eq!(a.lifetime_pnl_cents, -249_975);
    a.status = ActorStatus::Exiting;
    assert_eq!(
        revival::try_revive(a, &mut record, &mut w.dynamics, 0, 1200, 1, 2, &w.c).unwrap(),
        None
    );
    // A later episode still respects the lifetime per-actor cap but can restore eligibility.
    w.dynamics.episode = 2;
    assert_eq!(
        revival::try_revive(a, &mut record, &mut w.dynamics, 0, 1200, 1, 2, &w.c).unwrap(),
        Some(0)
    );
    assert_eq!(record.grants_cents, 100);
    assert_eq!(w.dynamics.total_grants_cents, 100);
    assert_eq!(w.dynamics.constrained_grants, 2);
    let b = &mut w.actors[1];
    b.status = ActorStatus::Exiting;
    w.c.revival_actor_cap_cents = w.c.actor_bankroll_cents;
    let mut other = ActorRecovery {
        actor_id: b.actor_id,
        exit_started_tick: 0,
        last_episode: 0,
        grants_cents: 0,
    };
    assert_eq!(
        revival::try_revive(b, &mut other, &mut w.dynamics, 0, 1200, 1, 2, &w.c).unwrap(),
        Some(1900)
    );
    assert_eq!(w.dynamics.total_grants_cents, 2000);
    assert_eq!(b.shares, shares);
}

#[test]
fn no_cash_revival_distinguishes_available_funding_from_exhausted_budgets() {
    for funded in [false, true] {
        let mut w = World::new(42, 200);
        w.price = 1;
        w.previous = 1;
        w.cash = 0;
        if !funded {
            w.c.revival_total_budget_bps = 0;
        }
        for a in &mut w.actors {
            a.status = ActorStatus::Exiting;
            a.cash_cents = 0;
        }
        let mut escaped = vec![false; w.actors.len()];
        for tick in 0..2000 {
            w.step(tick, 0);
            for (seen, actor) in escaped.iter_mut().zip(&w.actors) {
                *seen |= actor.status != ActorStatus::Exiting;
            }
        }
        w.audit();
        assert!(escaped.iter().all(|seen| *seen));
        assert!(w.dynamics.revived_actors > 0);
        if funded {
            assert!(w.grants > 0 && w.volume > 0);
        } else {
            assert_eq!(w.dynamics.revived_actors, 200);
            assert_eq!(w.grants, 0);
            assert_eq!(w.volume, 0);
            assert_eq!(w.price, 1);
            assert_eq!(w.active(), 200);
        }
    }
}

#[test]
fn retained_inventory_revival_tops_up_total_equity_not_cash() {
    let mut w = World::new(42, 20);
    w.dynamics.mode = "RECOVERY".into();
    w.dynamics.episode = 1;
    let a = &mut w.actors[0];
    a.cash_cents = 100_000;
    a.shares = 10;
    a.status = ActorStatus::Exiting;
    let mut record = ActorRecovery {
        actor_id: a.actor_id,
        exit_started_tick: 0,
        last_episode: 0,
        grants_cents: 0,
    };
    assert_eq!(
        revival::try_revive(a, &mut record, &mut w.dynamics, 0, 800, 10_000, 20, &w.c).unwrap(),
        Some(300_000)
    );
    lifecycle::finish(a, 800, 10_000).unwrap();
    assert_eq!(a.cash_cents, 400_000);
    assert_eq!(a.shares, 10);
    assert_eq!(a.marked_equity_cents, 500_000);
    assert_eq!(a.life_peak_equity_cents, 500_000);
    assert_eq!(a.lifetime_pnl_cents, -300_000);
    assert_eq!(record.grants_cents, 300_000);
    assert_eq!(w.dynamics.total_grants_cents, 300_000);
}

#[test]
fn high_value_retained_inventory_does_not_get_an_extra_cash_bankroll() {
    let mut w = World::new(42, 1);
    w.dynamics.mode = "RECOVERY".into();
    w.dynamics.episode = 1;
    let a = &mut w.actors[0];
    a.cash_cents = 0;
    a.shares = 1000;
    a.status = ActorStatus::Exiting;
    let mut record = ActorRecovery {
        actor_id: a.actor_id,
        exit_started_tick: 0,
        last_episode: 0,
        grants_cents: 0,
    };
    assert_eq!(
        revival::try_revive(a, &mut record, &mut w.dynamics, 0, 800, 10000, 1, &w.c).unwrap(),
        Some(0)
    );
    assert_eq!(a.cash_cents, 0);
    assert_eq!(a.shares, 1000);
    assert_eq!(a.status, ActorStatus::Active);
    assert_eq!(a.life_peak_equity_cents, 10_000_000);
}

#[test]
#[ignore = "exploratory large-population model, not a throughput qualification"]
fn hundred_thousand_actor_policy_comparison() {
    for variant in ["legacy", "quote-only", "signal-only", "full"] {
        let mut w = World::new(20261003, 100_000);
        if variant != "full" {
            w.c.valuation_spread_bps = 0;
            w.c.sentiment_max_bps = 0;
            w.c.shared_news_weight_bps = 0;
            w.c.quote_reversion_bps = if variant == "quote-only" { 500 } else { 2500 };
            w.c.signal_reversion_bps = if variant == "signal-only" {
                1000
            } else {
                10000
            };
        }
        for tick in 0..12_000 {
            w.step(tick, 0);
        }
        w.audit();
        w.report(variant);
        if variant == "full" {
            assert!(w.max - w.min > 1000, "meaningful movement at 100k");
            assert!(w.active() > 50_000 && w.volume > 0);
        }
    }
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

#[test]
#[ignore = "exploratory large-population soak, not a throughput qualification"]
fn hundred_thousand_actor_repeated_chaos_soak() {
    let mut w = World::new(20261003, 100_000);
    for tick in 0..48_000 {
        let news = if (1199..2399).contains(&tick) || (25199..26399).contains(&tick) {
            -8000
        } else {
            0
        };
        w.step(tick, news);
        if tick % 1200 == 1199 {
            w.audit();
        }
    }
    w.audit();
    w.report("100k repeated CHAOS 40-minute model");
    assert!(w.volume > 0 && w.active() > 50_000);
}
