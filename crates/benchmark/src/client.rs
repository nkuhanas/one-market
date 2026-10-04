use crate::bindings::*;
use spacetimedb_sdk::{DbContext, Table};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

pub type Result<T> = std::result::Result<T, String>;

pub struct Client {
    pub db: DbConnection,
    pub disconnects: Arc<AtomicU64>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Client {
    pub fn connect(
        uri: &str,
        database: &str,
        token: Option<String>,
        queries: Vec<String>,
    ) -> Result<Self> {
        let (tx, rx) = mpsc::channel();
        let error_tx = tx.clone();
        let disconnects = Arc::new(AtomicU64::new(0));
        let d = disconnects.clone();
        let db = DbConnection::builder()
            .with_uri(uri)
            .with_database_name(database)
            .with_token(token)
            .with_confirmed_reads(true)
            .on_connect(move |_, _, _| {
                let _ = tx.send(Ok(()));
            })
            .on_connect_error(move |_, e| {
                let _ = error_tx.send(Err(e.to_string()));
            })
            .on_disconnect(move |_, _| {
                d.fetch_add(1, Ordering::SeqCst);
            })
            .build()
            .map_err(|e| e.to_string())?;
        let handle = db.run_threaded();
        rx.recv_timeout(Duration::from_secs(15))
            .map_err(|e| e.to_string())??;
        let (tx, rx) = mpsc::channel();
        let error_tx = tx.clone();
        let ds = disconnects.clone();
        db.subscription_builder()
            .on_applied(move |_| {
                let _ = tx.send(Ok(()));
            })
            .on_error(move |_, e| {
                ds.fetch_add(1, Ordering::SeqCst);
                let _ = error_tx.send(Err(e.to_string()));
            })
            .subscribe(queries);
        rx.recv_timeout(Duration::from_secs(15))
            .map_err(|e| e.to_string())??;
        Ok(Self {
            db,
            disconnects,
            thread: Some(handle),
        })
    }

    pub fn healthy(&self) -> bool {
        self.db.is_active() && self.disconnects.load(Ordering::SeqCst) == 0
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.db.disconnect();
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

pub fn wait_until(mut condition: impl FnMut() -> bool, timeout: Duration) -> Result<()> {
    let start = Instant::now();
    while !condition() {
        if start.elapsed() > timeout {
            return Err("timed out waiting for committed state".into());
        }
        thread::sleep(Duration::from_millis(5));
    }
    Ok(())
}

pub fn public_queries() -> Vec<String> {
    one_market_core::config::config().observer_queries
}

pub fn control_queries() -> Vec<String> {
    [
        "runtime_config",
        "run_record",
        "market_state",
        "detailed_benchmark_receipts",
    ]
    .iter()
    .map(|t| format!("SELECT * FROM {t}"))
    .collect()
}

pub fn audit_queries() -> Vec<String> {
    let tables = [
        "actor_state",
        "human_trader",
        "grant_accounting",
        "runtime_config",
    ];
    let mut queries: Vec<_> = tables
        .iter()
        .map(|t| format!("SELECT * FROM {t}"))
        .collect();
    if cfg!(has_compact_actor_storage) {
        queries.push("SELECT * FROM actor_state_compact".into());
    }
    queries
}

pub struct AuditActor {
    pub actor_id: u64,
    pub cash_cents: u64,
    pub shares: u64,
    pub status: ActorStatus,
    pub wipeout_count: u64,
}

pub fn audit_actors(client: &Client) -> Result<Vec<AuditActor>> {
    #[allow(unused_mut)] // Old preserved schemas have no compact table.
    let mut actors: Vec<_> = client
        .db
        .db
        .actor_state()
        .iter()
        .map(|a| AuditActor {
            actor_id: a.actor_id,
            cash_cents: a.cash_cents,
            shares: a.shares,
            status: a.status,
            wipeout_count: a.wipeout_count,
        })
        .collect();
    #[cfg(has_compact_actor_storage)]
    for a in client.db.db.actor_state_compact().iter() {
        if a.flags & !15 != 0 {
            return Err("invalid compact actor flags".into());
        }
        actors.push(AuditActor {
            actor_id: a.actor_id,
            cash_cents: a.cash_cents.into(),
            shares: a.shares.into(),
            status: match a.flags & 3 {
                0 => ActorStatus::Active,
                1 => ActorStatus::Exiting,
                2 => ActorStatus::Cooldown,
                _ => return Err("invalid compact actor status".into()),
            },
            wipeout_count: a.wipeout_count.into(),
        });
    }
    let initialized = client
        .db
        .db
        .runtime_config()
        .id()
        .find(&0)
        .ok_or("runtime missing from population audit")?
        .initialized;
    validate_actor_ids(&actors, initialized)?;
    Ok(actors)
}

fn validate_actor_ids(actors: &[AuditActor], initialized: u64) -> Result<()> {
    if actors.len() as u64 != initialized {
        return Err("actor storage population mismatch".into());
    }
    let mut ids = std::collections::HashSet::with_capacity(actors.len());
    for a in actors {
        if a.actor_id == 0 || a.actor_id > initialized || !ids.insert(a.actor_id) {
            return Err("missing, duplicate, or out-of-range actor storage".into());
        }
    }
    Ok(())
}

pub fn audit(client: &Client) -> Result<()> {
    let g = client
        .db
        .db
        .grant_accounting()
        .id()
        .find(&0)
        .ok_or("grant accounting missing")?;
    let mut shares = 0u128;
    let mut cash = 0u128;
    for a in audit_actors(client)? {
        shares += u128::from(a.shares);
        cash += u128::from(a.cash_cents);
    }
    for h in client.db.db.human_trader().iter() {
        shares += u128::from(h.shares);
        cash += u128::from(h.cash_cents);
        if h.reserved_cash_cents > h.cash_cents || h.reserved_shares > h.shares {
            return Err("invalid human reservation".into());
        }
    }
    if shares != g.initial_share_supply {
        return Err("share conservation failed".into());
    }
    if cash != g.actor_initial_cash_cents + g.human_entry_cash_cents + g.recapitalization_cash_cents
    {
        return Err("cash/grant conservation failed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn population_audit_rejects_missing_duplicate_and_out_of_range_rows() {
        let check = |ids: &[u64], initialized| {
            let rows: Vec<_> = ids
                .iter()
                .map(|&actor_id| AuditActor {
                    actor_id,
                    cash_cents: 0,
                    shares: 0,
                    status: ActorStatus::Active,
                    wipeout_count: 0,
                })
                .collect();
            validate_actor_ids(&rows, initialized)
        };
        assert!(check(&[2, 1, 3], 3).is_ok());
        assert!(check(&[1, 2], 3).is_err());
        assert!(check(&[1, 2, 2], 3).is_err());
        assert!(check(&[0, 1, 2], 3).is_err());
        assert!(check(&[1, 2, 4], 3).is_err());
    }
}

#[macro_export]
macro_rules! invoke {
    ($client:expr, $method:ident ( $($arg:expr),* $(,)? )) => {{
        let (tx,rx)=std::sync::mpsc::channel();
        $client.db.reducers.$method($($arg,)* move |_,result| {
            let result=result.map_err(|e|format!("{e:?}")).and_then(|inner|inner);
            let _=tx.send(result);
        }).map_err(|e|e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(30)).map_err(|e|e.to_string())?
    }};
}
