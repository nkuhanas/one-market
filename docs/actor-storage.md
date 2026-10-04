# Actor storage operations

Actors have one authoritative private row, either `actor_state_compact` (74-byte
fixed-width BSATN) or `actor_state` (132 bytes). This is a lossless encoding of
the same logical actor. Policies and settlement still use full-width checked
arithmetic. Oversized balances, weights, counters or PnL use `actor_state`;
overflow from a compact row automatically promotes it in the tick transaction.
Promotion never clamps a field, skips an update, or changes inventory.

Fresh initialization uses compact rows when possible. Publishing with
`--delete-data=never` only adds the new private table and reducer: existing
actors stay full-width until explicitly migrated. Both representations work
together, including during partial migrations. Public subscriptions are unchanged.

## Opting in an existing world

Only the database owner/admin may call
`migrate_actor_storage_batch(start_actor_id: u64, count: u64, compact: bool)`.
Use the authenticated owner client or CLI against an explicitly verified target.

1. Pause and verify `runtime_config.enabled = false`, phase `READY`, and empty
   `tick_schedule` and `timed_run_stop` tables. Record the population, tick,
   balances/grants, cadence, and existing evidence. Do not reset the world.
2. Call the reducer with `compact = true`, contiguous IDs starting at 1, and
   counts of at most 500, ending at `runtime_config.initialized`. Each call is
   atomic; retrying an already migrated range is harmless. Out-of-range, empty,
   overflowing, or live-world requests fail without modifying state. Values
   that do not fit remain in the full-width table.
3. Verify the combined row count and unique IDs across both tables, bucket
   membership/coverage, conservation of cash/shares, and unchanged world state.
   An empty full-width table is not required for correctness. Never audit only
   `actor_state`, and never subscribe public observers to either private table.
4. Start an explicitly bounded measurement with the actual deployed build hash;
   the migration itself neither starts nor advances the simulation. Keep the
   tested cadence, offered order rate, viewer count and confirmation guarantees.

For an inverse migration, pause again and repeat all ranges with
`compact = false`. This restores full-width rows exactly. **Do not publish an
old binary that ignores compact rows while any compact rows remain.** A rollback
build should retain the additive schema even after reverse migration, avoiding
an unsupported table-drop migration. Preserve existing evidence and identities.

`./scripts/backend-smoke` covers mixed storage, atomic inverse migration,
overflow promotion and post-write rollback. `./scripts/upgrade-smoke` verifies
old-world publication without rewriting rows, all-row round-trip fingerprints,
and compact-row persistence across restart/republish before resuming.

## Performance scope

Smaller fixed-width rows target deserialization, database row updates, commit-log
payloads and host processing. They do not remove the O(actors-per-bucket) work or
the per-row update requirement. They also cannot eliminate host scheduling,
storage sync, replication, or noisy-neighbor stalls. Maincloud capacity needs a
fresh measurement; local results and inferred commit-log rotation periodicity
are not managed-server guarantees.
