# Preserved local comparison modules

These release WASM modules contain no database rows or CLI identity. They retain
the exact measured binaries independently of Docker cache lifetime.

| File | SHA-256 | Source |
| --- | --- | --- |
| `baseline-v02.wasm` | `863462dde83f39137100f91d946623a4f133643ac9975a78779f9d1349762ecd` | `baseline/v02-local-200` (`f507b23`) |
| `fixed-row.wasm` | `2b3b53fd6f709de7236c600d970805cf35dd80f8c75fd2cb29085048a55dcbcb` | `perf/fixed-row-v1` on `perf/local-capacity` |

Both were built with the repository's pinned Rust 1.93.0 / SpacetimeDB 2.10.1
release toolchain. Neither includes test controls or phase-timing instrumentation.
Each exploratory artifact also records its actual module hash, harness binary
hash, workload hash, environment, and raw committed receipts.

Use `MODULE_WASM=artifacts/builds/baseline-v02.wasm ./scripts/explore` to select
the original. The script generates an isolated private decoder and compiles the
current harness against it, without editing the normal production bindings.
`HARNESS_BIN` is an optional override for an already preserved compatible harness;
the original runs used the earlier binary hashes recorded in their artifacts.
