use crate::{config::Config, equity, mix, mul, Result};

#[derive(Clone, Copy, Debug)]
pub struct Weights {
    pub momentum: i32,
    pub reversion: i32,
    pub contrarian: i32,
    pub news: i32,
    pub conviction: u64,
    pub risk: u64,
}

pub fn weights(seed: u64, id: u64) -> Weights {
    let bits = mix(seed ^ id);
    Weights {
        momentum: (bits % 2001) as i32 - 1000,
        reversion: ((bits >> 12) % 2001) as i32 - 1000,
        contrarian: ((bits >> 24) % 2001) as i32 - 1000,
        news: ((bits >> 36) % 2001) as i32 - 1000,
        conviction: (bits >> 48) % 301 + 100,
        risk: (bits >> 54) % 2001 + 1000,
    }
}

#[derive(Clone, Copy)]
pub struct Signals {
    pub momentum_bps: i64,
    pub reversion_bps: i64,
    pub imbalance_bps: i64,
    pub news_bps: i64,
}

#[allow(clippy::too_many_arguments)]
pub fn decide(
    w: Weights,
    s: Signals,
    seed: u64,
    actor: u64,
    tick: u64,
    cash: u64,
    shares: u64,
    price: u64,
    c: &Config,
) -> Result<Option<(bool, u64, u64)>> {
    let noise = (mix(seed ^ mix(actor) ^ mix(tick)) % 2001) as i128 - 1000;
    let signal = (i128::from(w.momentum) * i128::from(s.momentum_bps)
        + i128::from(w.reversion.unsigned_abs()) * i128::from(s.reversion_bps)
        - i128::from(w.contrarian) * i128::from(s.imbalance_bps)
        + i128::from(w.news) * i128::from(s.news_bps))
        / 1000
        + noise;
    if signal.unsigned_abs() < u128::from(w.conviction) {
        return Ok(None);
    }
    let buy = signal > 0;
    let allowance = (signal.unsigned_abs() / 10).clamp(1, 500);
    let scaled = if buy {
        10_000 + allowance
    } else {
        10_000 - allowance
    };
    // A private reservation price, not a mutation of the traded market price.
    // Reuse stored weights so existing actors need no destructive regeneration.
    let anchor_bps = u128::from(w.reversion.unsigned_abs().min(1000))
        * u128::from(c.quote_reversion_bps.min(10_000))
        / 1000;
    let reference = i128::from(price)
        + (i128::from(c.initial_price_cents) - i128::from(price)) * anchor_bps as i128 / 10_000;
    let reference = u128::try_from(reference).map_err(|_| "negative reservation price")?;
    let scaled_limit = reference * scaled;
    let limit = u64::try_from(
        (if buy {
            scaled_limit.div_ceil(10_000)
        } else {
            scaled_limit / 10_000
        })
        .clamp(u128::from(c.min_price_cents), u128::from(c.max_price_cents)),
    )
    .map_err(|_| "limit overflow")?;
    let risk_budget = u128::from(equity(cash, shares, price)?) * u128::from(w.risk) / 10_000;
    let desired =
        u64::try_from((signal.unsigned_abs() / 100).clamp(1, u128::from(c.actor_max_quantity)))
            .map_err(|_| "sizing overflow")?;
    let quantity = desired
        .min(u64::try_from(risk_budget / u128::from(limit)).map_err(|_| "risk budget overflow")?)
        .min(if buy { cash / limit } else { shares });
    Ok((quantity > 0).then_some((buy, quantity, limit)))
}

/// A covered, good-for-one-auction slice. No buyer means no liquidation.
pub fn liquidation(shares: u64, price: u64, c: &Config) -> Result<Option<(bool, u64, u64)>> {
    if shares == 0 {
        return Ok(None);
    }
    let retained_bps = 10_000u64
        .checked_sub(c.liquidation_discount_bps)
        .ok_or("invalid liquidation discount")?;
    let limit = u64::try_from(
        (u128::from(price) * u128::from(retained_bps))
            .div_ceil(10_000)
            .clamp(u128::from(c.min_price_cents), u128::from(c.max_price_cents)),
    )
    .map_err(|_| "liquidation price overflow")?;
    let quantity = shares.min(c.liquidation_max_quantity);
    if quantity == 0 {
        return Err("liquidation quantity must be positive".into());
    }
    Ok(Some((false, quantity, limit)))
}

pub fn settle(cash: u64, shares: u64, buy: bool, quantity: u64, price: u64) -> Result<(u64, u64)> {
    let cost = mul(quantity, price)?;
    if buy {
        Ok((
            cash.checked_sub(cost).ok_or("unfunded buy")?,
            crate::add(shares, quantity)?,
        ))
    } else {
        Ok((
            crate::add(cash, cost)?,
            shares.checked_sub(quantity).ok_or("uncovered sell")?,
        ))
    }
}

pub fn pnl(marked: u64, initial: u64, grants: u64) -> Result<i64> {
    i64::try_from(i128::from(marked) - i128::from(initial) - i128::from(grants))
        .map_err(|_| "PnL overflow".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::config;

    fn strong_buyer(reversion: i32) -> Weights {
        Weights {
            momentum: 0,
            reversion,
            contrarian: 0,
            news: 1000,
            conviction: 1,
            risk: 3000,
        }
    }

    #[test]
    fn penny_quotes_round_up_and_buys_remain_funded() {
        let c = config();
        let s = Signals {
            momentum_bps: 0,
            reversion_bps: 0,
            imbalance_bps: 0,
            news_bps: 10_000,
        };
        let order = decide(strong_buyer(0), s, 1, 1, 0, 1000, 0, 1, &c)
            .unwrap()
            .unwrap();
        assert_eq!((order.0, order.2), (true, 2));
        assert!(order.1 * order.2 <= 1000);
        assert_eq!(
            decide(strong_buyer(0), s, 1, 1, 0, 0, 0, 1, &c).unwrap(),
            None
        );
        assert_eq!(
            decide(strong_buyer(0), s, 1, 1, 0, 1, 0, 1, &c).unwrap(),
            None
        );
    }

    #[test]
    fn distressed_quotes_use_real_valuation_bids_even_for_old_negative_weights() {
        let c = config();
        let s = Signals {
            momentum_bps: 0,
            reversion_bps: 99_990_000,
            imbalance_bps: 0,
            news_bps: -8000,
        };
        let (buy, quantity, limit) = decide(strong_buyer(-1000), s, 1, 1, 0, 5_000_000, 0, 1, &c)
            .unwrap()
            .unwrap();
        assert!(buy && limit > 1 && quantity > 0);
        assert!(quantity * limit <= 5_000_000);
    }

    #[test]
    fn liquidation_is_bounded_and_rounds_reserve_up() {
        let c = config();
        assert_eq!(liquidation(500, 9812, &c).unwrap(), Some((false, 10, 9322)));
        assert_eq!(liquidation(3, 1, &c).unwrap(), Some((false, 3, 1)));
        assert_eq!(liquidation(3, 2, &c).unwrap(), Some((false, 3, 2)));
        assert_eq!(liquidation(0, 9812, &c).unwrap(), None);
        let mut large = c.clone();
        large.max_price_cents = u64::MAX;
        assert_eq!(
            liquidation(u64::MAX, u64::MAX, &large).unwrap().unwrap().2,
            u64::try_from((u128::from(u64::MAX) * 9500).div_ceil(10_000)).unwrap()
        );
        large.liquidation_discount_bps = 10_001;
        assert!(liquidation(1, 100, &large).is_err());
    }

    #[test]
    fn liquidation_cannot_introduce_a_distant_penny_clearing_candidate() {
        use crate::auction::{clear, Order};
        let c = config();
        let (_, quantity, limit) = liquidation(500, 9812, &c).unwrap().unwrap();
        let orders = [
            Order {
                key: 1,
                buy: false,
                quantity,
                limit,
            },
            Order {
                key: 2,
                buy: false,
                quantity: 5,
                limit: 9700,
            },
            Order {
                key: 3,
                buy: true,
                quantity: 10,
                limit: 10200,
            },
        ];
        let result = clear(&orders, 9812, 1).unwrap();
        assert_eq!(
            (result.price, result.volume, result.fills[0]),
            (9322, 10, 10)
        );
        let mut original = orders;
        original[0].quantity = 500;
        original[0].limit = 1;
        assert_eq!(clear(&original, 9812, 1).unwrap().price, 1);
    }

    #[test]
    fn quote_boundaries_and_financial_overflow_are_checked() {
        let c = config();
        for price in [1, 2, 19, 20, 10_000, c.max_price_cents, u64::MAX] {
            for reversion in [i32::MIN, -1000, 0, 1000, i32::MAX] {
                let s = Signals {
                    momentum_bps: 0,
                    reversion_bps: 10000,
                    imbalance_bps: 0,
                    news_bps: 10000,
                };
                if let Some((buy, quantity, limit)) =
                    decide(strong_buyer(reversion), s, 1, 1, 0, u64::MAX, 0, price, &c).unwrap()
                {
                    assert!(buy);
                    assert!((c.min_price_cents..=c.max_price_cents).contains(&limit));
                    assert!(quantity <= c.actor_max_quantity);
                    assert!(u128::from(quantity) * u128::from(limit) <= u128::from(u64::MAX));
                }
            }
        }
        let s = Signals {
            momentum_bps: 0,
            reversion_bps: 10000,
            imbalance_bps: 0,
            news_bps: 10000,
        };
        assert!(decide(strong_buyer(1000), s, 1, 1, 0, u64::MAX, 1, 1, &c).is_err());
    }
    #[test]
    fn settlement_checks_balances_and_grant_adjustment() {
        assert_eq!(settle(1000, 0, true, 2, 100).unwrap(), (800, 2));
        assert_eq!(settle(800, 2, false, 2, 100).unwrap(), (1000, 0));
        assert!(settle(0, 0, true, 1, 1).is_err());
        assert!(settle(0, 0, false, 1, 1).is_err());
        assert!(settle(u64::MAX, 1, false, 1, 1).is_err());
        assert_eq!(pnl(10_000_000, 10_000_000, 5_000_000).unwrap(), -5_000_000);
    }
}
