# Benchmark harness

The release Rust harness runs the fixed workload in [SPEC.md](../../SPEC.md):
30 seconds warm-up, 180 seconds measurement, three production-query viewers, five
offered human orders per second, confirmed reads, and three fresh confirmations.
`CADENCE=20hz` is the default; `10hz` and `5hz` are selectable.
The scheduler, evidence windows and gates use the selected interval;
all profiles retain 20 actor buckets. Market `PROFILE=NORMAL|CHAOS` is separate.

Use `./scripts/benchmark` from the repository root. It creates isolated local
databases, runs NORMAL and CHAOS at 200 actors, and exports JSON/CSV evidence to
`artifacts/baseline/`. It never discovers or advertises maximum capacity.
Use `CADENCE=10hz POPULATION=375000 ./scripts/explore` for a non-qualifying
probe. At 10 Hz use at least 240 target seconds to observe a complete CHAOS
shock, and a longer window for its aftermath. No live world is resized.

See [methodology](../../docs/benchmark-methodology.md) for gates, artifact fields,
failure interpretation, and authorized Maincloud commands. Generated private
Rust bindings do not bypass database permissions: the harness uses the database
owner's identity, while its three viewers and human use ordinary identities.
