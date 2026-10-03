# Preserved local evidence

## Capacity optimization

[`baseline/20261003T224614Z-3341112`](baseline/20261003T224614Z-3341112/) qualifies
325,000 persistent actors locally in three NORMAL and three CHAOS confirmations.
All six passed with zero skipped slots and 58,500,000 measured actor updates
each. `archive-audit.txt` verifies raw JSON/CSV, exact hashes and server readbacks.
This is the highest combined candidate qualified in this investigation, not a
Maincloud result or an upper bound on SpacetimeDB.

[`baseline/20261003T220900Z-3162127`](baseline/20261003T220900Z-3162127/) retains
the failed 337,500 combined candidate: NORMAL passed all three, but CHAOS failed
two confirmations with a skipped slot each. It must not be relabeled or combined
with selected passing repeats. Its archive audit correctly rejects CHAOS.

`exploration/capacity.csv` indexes the shortened probes and their raw JSON/CSV,
including failures and separate host/phase-timing diagnostics. `profiling/`
retains native CPU evidence; `builds/` preserves exact original/optimized release
WASM binaries. See the
[capacity worklog](../docs/capacity-worklog.md) for comparisons and limitations.

`verification/20261003-capacity/` contains final code, backend and browser check
logs. Its `archive-rejection.txt` is the expected negative audit of the failed
337,500 archive, not an unexpected regression failure.

## Original v0.2 baseline

The original six-run v0.2 local qualification is
[`baseline/20261003T200840Z-2571553`](baseline/20261003T200840Z-2571553/):
three PASSED NORMAL and three PASSED CHAOS runs at 200 actors. Each used the
same release module, ten production-query viewers, five offered human orders
per second, 30 seconds warm-up and 180 seconds measurement. All six committed
36,000 measured actor updates with zero skipped slots.

Each profile contains its exact workload bytes, three raw JSON/CSV runs, and a
summary linking the three artifact hashes. Do not reformat the JSON: evidence
hashes cover exact bytes. See the [handoff](../docs/backend-handoff.md) for
per-run results and [methodology](../docs/benchmark-methodology.md) for gates and
timing limitations. This is a local baseline, not maximum or Maincloud capacity.

`baseline/20261003T183504Z-2130750/normal/` is preliminary evidence from an older
build/hash format. It is retained for traceability, not mixed into the final
six-run qualification.
