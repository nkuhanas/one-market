# Actor-cost probe builds

Pinned Rust 1.93.0 and SpacetimeDB 2.10.1, release builds. Source base is
`209c7cc` (frontend PR #9); the control backend is unchanged from `e049caf`.
The candidate source is the actor-cost delta on `perf/maincloud-actor-cost`.

| File | SHA-256 | Purpose |
| --- | --- | --- |
| control.wasm | 9e4231ba38fa88b5f5646c6ae73e27d5177b79b7f8050c57a242c8ee6e1a95bf | Previous production, ordinary build |
| control-profile.wasm | 1b176b86f7de343151d3effb15ac73c067523b85dbff5585ec7172041127e314 | Previous backend with existing sampled timers |
| candidate.wasm | a271baa73792444602106614fe2b8b3e05b25a025edcef1145e874828dae58fc | New ordinary build, profiling compiled out |
| candidate-profile.wasm | 54c64c6970696efc8eaeeb5f72e203e3b59ec37a76859940c1d0f980de3bc056 | New backend with sampled phase and tick-body timers |

Diagnostic builds reject qualification starts. Their timers exclude host work
after the reducer returns. The ordinary build retains the same policies, row
schema and cadence; no actor migration or reset is needed.

The candidate diagnostic binary was built both with Cargo `--release --features
profile-ticks` and with `spacetime build --module-path crates/spacetime --features
profile-ticks` (including its wasm-opt step); the resulting hashes are identical.
