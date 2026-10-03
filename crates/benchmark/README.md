# Benchmark harness

The release Rust harness runs the fixed workload in [SPEC.md](../../SPEC.md):
30 seconds warm-up, 180 seconds measurement, ten production-query viewers, five
offered human orders per second, confirmed reads, and three fresh confirmations.

Use `./scripts/benchmark` from the repository root. It creates isolated local
databases, runs NORMAL and CHAOS at 200 actors, and exports JSON/CSV evidence to
`artifacts/baseline/`. It never discovers or advertises maximum capacity.

See [methodology](../../docs/benchmark-methodology.md) for gates, artifact fields,
failure interpretation, and authorized Maincloud commands. Generated private
Rust bindings do not bypass database permissions: the harness uses the database
owner's identity, while its ten viewers and human use ordinary identities.
