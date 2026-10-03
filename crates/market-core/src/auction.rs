use crate::{mix, Result};
use std::cmp::Reverse;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Order {
    pub key: u64,
    pub buy: bool,
    pub quantity: u64,
    pub limit: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Clearing {
    pub price: u64,
    pub volume: u64,
    /// Quantities in input order; each order counts once if this is positive.
    pub fills: Vec<u64>,
}

/// O(K log K) candidate sweep, followed by price/seed priority allocation.
pub fn clear(orders: &[Order], previous: u64, seed: u64) -> Result<Clearing> {
    if previous == 0 || orders.iter().any(|o| o.limit == 0 || o.quantity == 0) {
        return Err("price and quantity must be positive".into());
    }
    let mut events: Vec<(u64, bool, u64)> = orders
        .iter()
        .map(|o| (o.limit, o.buy, o.quantity))
        .collect();
    events.push((previous, false, 0));
    events.sort_unstable_by_key(|e| e.0);
    let mut demand: u128 = orders
        .iter()
        .filter(|o| o.buy)
        .map(|o| u128::from(o.quantity))
        .sum();
    let mut supply = 0u128;
    let mut best = (Reverse(0u128), u128::MAX, u64::MAX, previous);
    let mut i = 0;
    while i < events.len() {
        let price = events[i].0;
        let mut buy_at = 0u128;
        while i < events.len() && events[i].0 == price {
            let (_, buy, quantity) = events[i];
            if buy {
                buy_at += u128::from(quantity);
            } else {
                supply += u128::from(quantity);
            }
            i += 1;
        }
        let candidate = (
            Reverse(demand.min(supply)),
            demand.abs_diff(supply),
            price.abs_diff(previous),
            price,
        );
        best = best.min(candidate);
        demand -= buy_at;
    }
    let volume = u64::try_from(best.0 .0).map_err(|_| "auction volume overflow")?;
    let price = if volume == 0 { previous } else { best.3 };
    let mut fills = vec![0; orders.len()];
    for buy in [true, false] {
        let mut indices: Vec<usize> = orders
            .iter()
            .enumerate()
            .filter(|(_, o)| {
                o.buy == buy
                    && if buy {
                        o.limit >= price
                    } else {
                        o.limit <= price
                    }
            })
            .map(|(i, _)| i)
            .collect();
        indices.sort_unstable_by_key(|&i| {
            let o = &orders[i];
            (
                if buy { u64::MAX - o.limit } else { o.limit },
                mix(seed ^ o.key),
                o.key,
            )
        });
        let mut remaining = volume;
        for i in indices {
            fills[i] = orders[i].quantity.min(remaining);
            remaining -= fills[i];
        }
        if remaining != 0 {
            return Err("auction allocation imbalance".into());
        }
    }
    Ok(Clearing {
        price,
        volume,
        fills,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    // Intentionally quadratic independent oracle, used only for tiny tests.
    fn reference_price(orders: &[Order], previous: u64) -> (u64, u64) {
        let candidates: BTreeSet<_> = orders.iter().map(|o| o.limit).chain([previous]).collect();
        let best = candidates
            .into_iter()
            .map(|p| {
                let d: u128 = orders
                    .iter()
                    .filter(|o| o.buy && o.limit >= p)
                    .map(|o| o.quantity as u128)
                    .sum();
                let s: u128 = orders
                    .iter()
                    .filter(|o| !o.buy && o.limit <= p)
                    .map(|o| o.quantity as u128)
                    .sum();
                (Reverse(d.min(s)), d.abs_diff(s), p.abs_diff(previous), p)
            })
            .min()
            .unwrap();
        (
            if best.0 .0 == 0 { previous } else { best.3 },
            best.0 .0 as u64,
        )
    }

    #[test]
    fn differential_and_conservation() {
        for seed in 0..10_000u64 {
            let previous = mix(seed) % 20 + 1;
            let orders: Vec<_> = (0..seed % 17)
                .map(|key| {
                    let bits = mix(seed.wrapping_mul(113) ^ key);
                    Order {
                        key,
                        buy: bits & 1 == 0,
                        quantity: bits % 10 + 1,
                        limit: (bits >> 8) % 25 + 1,
                    }
                })
                .collect();
            let result = clear(&orders, previous, seed).unwrap();
            assert_eq!(
                (result.price, result.volume),
                reference_price(&orders, previous)
            );
            let mut buys = 0u64;
            let mut sells = 0u64;
            for (order, filled) in orders.iter().zip(&result.fills) {
                assert!(*filled <= order.quantity);
                if *filled > 0 {
                    assert!(if order.buy {
                        order.limit >= result.price
                    } else {
                        order.limit <= result.price
                    });
                }
                if order.buy {
                    buys += filled;
                } else {
                    sells += filled;
                }
            }
            assert_eq!(buys, sells);
            assert_eq!(buys, result.volume);
            assert_eq!(
                u128::from(buys) * u128::from(result.price),
                u128::from(sells) * u128::from(result.price)
            );
        }
    }

    #[test]
    fn priority_partial_and_no_counterparty() {
        let orders = vec![
            Order {
                key: 1,
                buy: true,
                quantity: 4,
                limit: 110,
            },
            Order {
                key: 2,
                buy: true,
                quantity: 4,
                limit: 100,
            },
            Order {
                key: 3,
                buy: false,
                quantity: 5,
                limit: 90,
            },
        ];
        let result = clear(&orders, 100, 1).unwrap();
        assert_eq!(result.fills, vec![4, 1, 5]);
        let frozen = clear(&orders[2..], 100, 1).unwrap();
        assert_eq!((frozen.price, frozen.volume), (100, 0));
    }

    #[test]
    fn ties_are_seeded_deterministic_and_input_order_independent() {
        let orders = vec![
            Order {
                key: 10,
                buy: true,
                quantity: 4,
                limit: 100,
            },
            Order {
                key: 20,
                buy: true,
                quantity: 4,
                limit: 100,
            },
            Order {
                key: 30,
                buy: false,
                quantity: 5,
                limit: 100,
            },
        ];
        let a = clear(&orders, 100, 4).unwrap();
        let mut reversed = orders.clone();
        reversed.reverse();
        let mut b = clear(&reversed, 100, 4).unwrap();
        b.fills.reverse();
        assert_eq!(a, b);
        assert!(a.fills[..2].contains(&4));
        assert!(a.fills[..2].contains(&1));
    }

    #[test]
    fn rejects_overflow_and_invalid_orders() {
        let mut orders = vec![];
        for key in 0..4 {
            orders.push(Order {
                key,
                buy: key < 2,
                quantity: u64::MAX,
                limit: 1,
            });
        }
        assert!(clear(&orders, 1, 0).is_err());
        assert!(crate::mul(u64::MAX, 2).is_err());
        assert!(crate::equity(1, u64::MAX, 1).is_err());
        assert!(clear(&[], 0, 0).is_err());
    }
}
