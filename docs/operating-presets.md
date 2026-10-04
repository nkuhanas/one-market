# Operating presets

Recorded at the user's request on 2026-10-04. The durable machine-readable source
is [config/operating-presets.json](../config/operating-presets.json). These are
chosen **local operating starting points**, not new qualified capacity results or
universal limits. The corrected 10 Hz preset is **750,000**, not 800,000.

| Cadence |    Actors | Target interval per actor | Expected actor updates/sec | Evidence                                                        |
| ------- | --------: | ------------------------- | -------------------------: | --------------------------------------------------------------- |
| 20 Hz   |   375,000 | 1 second                  |                    375,000 | Accepted historical working baseline; older policy, ten viewers |
| 10 Hz   |   750,000 | 2 seconds                 |                    375,000 | Three viewers, NORMAL, 10s warm-up + 30s measured; zero skips   |
| 5 Hz    | 1,000,000 | 4 seconds                 |                    250,000 | Three viewers, NORMAL, 30s warm-up + 180s measured; zero skips  |

The rates above assume maintained cadence. The 10/5 Hz measured P99 **start
lateness** was 47.139/13.255 ms, respectively, not execution duration. The 20 Hz
reference predates the current weak-restoring dynamics/revival policy. None of
these presets establishes Maincloud capacity, and the newer presets have no
CHAOS confirmation. Detailed evidence, failures and the interrupted 812.5k probe
remain in the [capacity worklog](capacity-worklog.md#selectable-cadence-investigation--2026-10-04).

The preset record is intentionally separate from the compiled `config/v02.json`:
recording population choices must not change the measured workload hashes,
change scheduler intervals, or invalidate a running world's policy. The existing
cadence registry remains the scheduler's source of truth. Tests verify that every
preset references a registered cadence, a legal population and matching passing
evidence. The record does not auto-apply settings or publish a `BenchmarkResult`.

Use the existing explicit `CADENCE` and `POPULATION` arguments when starting a
fresh local world or probe, for example `CADENCE=10hz POPULATION=750000`.
Recording a preset does **not** resize, reset or start any database. Changing an
existing world's cadence still requires the owner-only pause/select/start flow;
changing its population is a separate, explicit operation, not part of a cadence
switch. Maincloud remains paused with 100,000 actors; the default cadence remains
20 Hz and ordinary local startup remains at 200 actors.

Benchmark artifacts and release WASM binaries are retained in Git independently
of disposable local probe databases. Disk cleanup may remove those databases
after verifying their archived evidence, but must not remove this record, the
raw artifacts, development worlds, or CLI identities.

The first [disk cleanup](maintenance/2026-10-04-disk-cleanup.md) removed the seven
archived cadence-probe databases and regenerable caches. The evidence linked by
these presets remains committed; exact final actor rows are not a retained backup.
