use crate::Result;

pub fn deadline(origin_us: i64, slot: u64, interval_us: u64) -> Result<i64> {
    if interval_us == 0 {
        return Err("zero tick interval".into());
    }
    let value = i128::from(slot)
        .checked_mul(i128::from(interval_us))
        .and_then(|delta| i128::from(origin_us).checked_add(delta))
        .ok_or("deadline overflow")?;
    i64::try_from(value).map_err(|_| "deadline overflow".into())
}

pub fn advance(
    origin_us: i64,
    slot: u64,
    invoked_us: i64,
    interval_us: u64,
) -> Result<(u64, u64, u64)> {
    let intended = deadline(origin_us, slot, interval_us)?;
    let lateness = u64::try_from(i128::from(invoked_us) - i128::from(intended))
        .map_err(|_| "early callback")?;
    let skipped = lateness / interval_us;
    let next = slot
        .checked_add(skipped)
        .and_then(|s| s.checked_add(1))
        .ok_or("slot overflow")?;
    Ok((next, skipped, lateness))
}

/// First future slot on the original grid; used by explicit stall recovery.
pub fn next_slot(origin_us: i64, now_us: i64, interval_us: u64) -> Result<u64> {
    if interval_us == 0 {
        return Err("zero tick interval".into());
    }
    let elapsed = i128::from(now_us) - i128::from(origin_us);
    if elapsed < 0 {
        return Ok(1);
    }
    u64::try_from(elapsed / i128::from(interval_us) + 1).map_err(|_| "slot overflow".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_original_deadline_and_exposes_gaps() {
        for cadence in crate::config::config().cadence_profiles {
            let interval = cadence.tick_interval_us;
            let first = deadline(100, 1, interval).unwrap();
            assert_eq!(advance(100, 1, first + 10, interval).unwrap(), (2, 0, 10));
            assert_eq!(
                advance(100, 1, first + (interval * 2 + 25) as i64, interval).unwrap(),
                (4, 2, interval * 2 + 25)
            );
            assert_eq!(
                deadline(100, 4, interval).unwrap(),
                100 + (4 * interval) as i64
            );
            assert!(advance(100, 1, first - 1, interval).is_err());
            assert_eq!(next_slot(100, 99, interval).unwrap(), 1);
            assert_eq!(next_slot(100, first, interval).unwrap(), 2);
            assert!(deadline(i64::MAX, 1, interval).is_err());
        }
        assert!(deadline(0, u64::MAX, u64::MAX).is_err());
        assert!(deadline(0, 1, 0).is_err());
        assert!(next_slot(0, 0, 0).is_err());
    }
}
