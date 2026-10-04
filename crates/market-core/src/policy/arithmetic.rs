// WASM has native 64-bit division, but lowers wide division to software. Most
// market values fit the narrow path. Keep the full-width path for large valid
// balances, prices and long-lived ticks; never narrow by an unchecked cast.
#[inline]
pub(super) fn unsigned(n: u128, d: u128) -> u128 {
    match (u64::try_from(n), u64::try_from(d)) {
        (Ok(n), Ok(d)) => u128::from(n / d),
        _ => n / d,
    }
}

#[inline]
pub(super) fn signed(n: i128, d: i128) -> i128 {
    match (i64::try_from(n), i64::try_from(d)) {
        // MIN / -1 fits i128, not i64. Retain the original domain.
        (Ok(n), Ok(d)) if !(n == i64::MIN && d == -1) => i128::from(n / d),
        _ => n / d,
    }
}

#[inline]
pub(super) fn ceil(n: u128, d: u128) -> u128 {
    match (u64::try_from(n), u64::try_from(d)) {
        (Ok(n), Ok(d)) => u128::from(n.div_ceil(d)),
        _ => n.div_ceil(d),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn narrow_and_wide_paths_preserve_rounding_and_extremes() {
        let values = [
            0,
            1,
            9999,
            10000,
            u128::from(u64::MAX),
            u128::from(u64::MAX) + 1,
            u128::MAX,
        ];
        for n in values {
            for d in values.into_iter().filter(|d| *d != 0) {
                assert_eq!(unsigned(n, d), n / d);
                assert_eq!(ceil(n, d), n.div_ceil(d));
            }
        }
        let values = [
            i128::MIN,
            i128::from(i64::MIN) - 1,
            i128::from(i64::MIN),
            -10001,
            -1,
            0,
            1,
            10001,
            i128::from(i64::MAX),
            i128::from(i64::MAX) + 1,
            i128::MAX,
        ];
        for n in values {
            for d in values
                .into_iter()
                .filter(|d| *d != 0 && !(n == i128::MIN && *d == -1))
            {
                assert_eq!(signed(n, d), n / d);
            }
        }
    }
}
