# Tested local versions

The local v0.2 compatibility gate uses:

| Component           | Version                                                                   |
| ------------------- | ------------------------------------------------------------------------- |
| CLI/runtime         | SpacetimeDB 2.10.1                                                        |
| CLI build           | `3d7607082ab47257adeb7c25164536511237f2b5`                                |
| Runtime base image  | `clockworklabs/spacetime:v2.10.1`                                         |
| Pulled image digest | `sha256:5231fa24bc8eaa28b2a3c6a4725f1d31e6a868e2e9b311c8efa1ddc314466014` |
| Rust module SDK     | `spacetimedb =2.10.1`                                                     |
| Rust client SDK     | `spacetimedb-sdk =2.10.1`                                                 |
| TypeScript SDK      | `spacetimedb 2.10.1`                                                      |
| Rust toolchain      | `1.93.0 (254b59607 2026-01-19)`                                           |
| Node / Playwright   | `24.21.0` / `1.63.0`                                                      |

The measured release-WASM SHA-256 is
`863462dde83f39137100f91d946623a4f133643ac9975a78779f9d1349762ecd`.
The generated private Rust binding-tree BLAKE3 is
`de7cb2785c277e503ad145e6decd260acebf9cbf07496b895f4b27f4e78c506d`
(sorted filenames followed by their exact bytes). Both are recorded in each
artifact, along with the Cargo.lock BLAKE3 and observed host metadata. The public
TypeScript bindings and private Rust bindings are generated from this same WASM;
`scripts/check` independently regenerates both and requires exact file equality.

Maincloud runtime/build: unavailable; no selected development database or
credentials were provided, and no managed service has been accessed.

`scripts/backend-smoke` passed all twelve real-runtime tests against this stack:
absolute-time callbacks advance state, anonymous and owner manual scheduler calls fail,
non-admin control calls fail, direct private-table subscriptions fail for ordinary
clients, caller-scoped trader/order/fill views isolate identities, and owner
subscriptions can read private retained receipts. Connections explicitly request
confirmed reads; awaited per-call results and committed subscription state were
used throughout. This establishes operation with the configured read mode, not
a separate disk-power-loss durability experiment. Pause/recovery retains FAILED
and records missing slots. Late/stale callbacks, a post-write transaction failure,
stalled tick recovery, pruned-history replay, and persistent PASS/EXITING/COOLDOWN
updates are covered. Fault reducers exist only in a separately built test module;
they are absent from production bindings/WASM.

Source references used to interpret the APIs: [views](https://spacetimedb.com/docs/functions/views/),
[schedule tables](https://spacetimedb.com/docs/tables/schedule-tables/).
Observed tests and the pinned source take precedence over examples from other
versions. See [backend handoff](backend-handoff.md) for complete run evidence and
remaining deployment limitations.
