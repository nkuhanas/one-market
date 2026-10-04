# Compact actor storage builds

Retained locally verified binaries; neither has been deployed to Maincloud.
SpacetimeDB CLI/runtime/SDK 2.10.1, committed Cargo lockfile. Only the profiling
build emits sampled phase timers; ordinary publication should use `regular.wasm`.

| File | SHA-256 |
| --- | --- |
| `regular.wasm` | `b9cd69c6bdf7b3b16529b60ffd9fed0567a7449ac259c725a600b68b88f71f6c` |
| `profile.wasm` | `e3d6299f56716aa8c05b56f9714f849d2ab133270fd6956590943c4b961b1bf2` |
| Baseline `../actor-cost/candidate-profile.wasm` | `54c64c6970696efc8eaeeb5f72e203e3b59ec37a76859940c1d0f980de3bc056` |

See the [delta](../../../deltas/compact-actor-storage_2026-10-04_02-04-15_EST.md)
for the measurements and [storage procedure](../../../docs/actor-storage.md)
for additive, reversible migration. Never deploy a binary that ignores compact
rows over a world containing them. The regular build was checked and used by
the non-destructive upgrade/restart and browser tests. Performance probes used
profile builds on both sides.

Reproduce in Docker on separate fresh LOCAL worlds (never a production reset):

```sh
CADENCE=5hz POPULATION=1000000 WARMUP_SECONDS=5 MEASUREMENT_SECONDS=60 \
  MODULE_WASM=artifacts/builds/actor-cost/candidate-profile.wasm ./scripts/explore
CADENCE=5hz POPULATION=1000000 WARMUP_SECONDS=5 MEASUREMENT_SECONDS=60 \
  MODULE_WASM=artifacts/builds/compact-actor-storage/profile.wasm ./scripts/explore
```

The probe harness detects cadence and actor-storage capabilities from the
selected binary's generated bindings. Keep three viewers and five offered
orders/s; do not run builds or other benchmarks during measurement. Collect
phase logs afterward with `scripts/collect-profile DATABASE OUTPUT_DIRECTORY`.
Run `node scripts/report-actor-storage.mjs BASELINE_DIRECTORY CANDIDATE_DIRECTORY`
in the web container to reproduce the paired host-metric comparison.
