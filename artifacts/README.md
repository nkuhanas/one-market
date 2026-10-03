# Preserved baseline evidence

The final v0.2 local qualification is
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
