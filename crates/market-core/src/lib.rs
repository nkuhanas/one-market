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

pub fn extend_digest(previous: &[u8], actor_id: u64) -> Vec<u8> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(previous);
    hasher.update(&actor_id.to_le_bytes());
    hasher.finalize().as_bytes().to_vec()
}
