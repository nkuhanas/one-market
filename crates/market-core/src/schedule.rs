use crate::Result;

pub const INTERVAL_US: i64 = 50_000;

pub fn deadline(origin_us: i64, slot: u64) -> Result<i64> {
    let delta = i128::from(slot) * i128::from(INTERVAL_US);
    i64::try_from(i128::from(origin_us) + delta).map_err(|_| "deadline overflow".into())
}

pub fn advance(origin_us: i64, slot: u64, invoked_us: i64) -> Result<(u64, u64, u64)> {
    let intended = deadline(origin_us, slot)?;
    let lateness = u64::try_from(i128::from(invoked_us) - i128::from(intended))
        .map_err(|_| "early callback")?;
    let skipped = lateness / INTERVAL_US as u64;
    let next = slot
        .checked_add(skipped)
        .and_then(|s| s.checked_add(1))
        .ok_or("slot overflow")?;
    Ok((next, skipped, lateness))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_original_deadline_and_exposes_gaps() {
        assert_eq!(advance(100, 1, 50_110).unwrap(), (2, 0, 10));
        assert_eq!(advance(100, 1, 175_100).unwrap(), (4, 2, 125_000));
        assert_eq!(deadline(100, 4).unwrap(), 200_100);
        assert!(advance(100, 1, 50_099).is_err());
        assert!(deadline(i64::MAX, 1).is_err());
    }
}
