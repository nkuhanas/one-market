use crate::{equity, mix, mul, Result};

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
    max_quantity: u64,
    max_price: u64,
) -> Result<Option<(bool, u64, u64)>> {
    let noise = (mix(seed ^ mix(actor) ^ mix(tick)) % 2001) as i128 - 1000;
    let signal = (i128::from(w.momentum) * i128::from(s.momentum_bps)
        + i128::from(w.reversion) * i128::from(s.reversion_bps)
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
    let limit =
        u64::try_from((u128::from(price) * scaled / 10_000).clamp(1, u128::from(max_price)))
            .map_err(|_| "limit overflow")?;
    let risk_budget = u128::from(equity(cash, shares, price)?) * u128::from(w.risk) / 10_000;
    let desired = u64::try_from((signal.unsigned_abs() / 100).clamp(1, u128::from(max_quantity)))
        .map_err(|_| "sizing overflow")?;
    let quantity = desired
        .min(u64::try_from(risk_budget / u128::from(limit)).map_err(|_| "risk budget overflow")?)
        .min(if buy { cash / limit } else { shares });
    Ok((quantity > 0).then_some((buy, quantity, limit)))
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
