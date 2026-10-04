pub mod auction;
pub mod config;
pub mod evidence;
pub mod policy;
pub mod schedule;

pub type Result<T, E = String> = std::result::Result<T, E>;

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b)
        .ok_or_else(|| "integer addition overflow".into())
}

pub fn mul(a: u64, b: u64) -> Result<u64> {
    u64::try_from(u128::from(a) * u128::from(b)).map_err(|_| "integer product overflow".into())
}

pub fn equity(cash: u64, shares: u64, price: u64) -> Result<u64> {
    add(cash, mul(shares, price)?)
}

/// SplitMix64 finalizer, explicitly wrapping only for deterministic random bits.
pub fn mix(mut value: u64) -> u64 {
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

pub fn bucket(actor_id: u64) -> u8 {
    (mix(actor_id) % 20) as u8
}

pub fn extend_digest(previous: &[u8], actor_id: u64) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(previous);
    hasher.update(&actor_id.to_le_bytes());
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod digest_tests {
    use super::*;

    fn old_extend(previous: &[u8], actor_id: u64) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(previous);
        hasher.update(&actor_id.to_le_bytes());
        hasher.finalize().as_bytes().to_vec()
    }

    fn assert_chain(ids: impl IntoIterator<Item = u64>) {
        let mut old = vec![0; 32];
        let mut new = [0; 32];
        assert_eq!(old, new);
        for id in ids {
            old = old_extend(&old, id);
            new = extend_digest(&new, id);
            assert_eq!(old, new, "digest changed at actor {id}");
        }
        // Receipt/schema boundary must retain the identical byte representation.
        assert_eq!(old, new.to_vec());
    }

    #[test]
    fn fixed_digest_matches_original_empty_multi_and_boundary_chains() {
        assert_chain([]);
        assert_chain([1]);
        assert_chain([1, 2, 3, 40, 325_000, 500_000]);
        assert_chain([0, u64::MAX, 1, u64::MAX - 1]);
    }

    #[test]
    fn fixed_digest_matches_all_representative_buckets() {
        for population in [20, 200, 325_000, 337_500, 350_000, 500_000] {
            let mut old = vec![vec![0; 32]; 20];
            let mut new = [[0; 32]; 20];
            for id in 1..=population {
                let b = usize::from(bucket(id));
                old[b] = old_extend(&old[b], id);
                new[b] = extend_digest(&new[b], id);
                assert_eq!(old[b], new[b]);
            }
        }
    }
}
