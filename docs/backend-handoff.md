# v0.2 backend handoff

The backend implements the v0.2 market and a modest, measured local baseline.
`apps/web`, Vercel configuration, and `SPEC.md` are unchanged. The latest main
specification is the input contract, not a file rewritten to fit implementation.
This page records the original baseline preserved at `baseline/v02-local-200`
(`f507b23`). Subsequent work is on `perf/local-capacity`; see the
[capacity worklog](capacity-worklog.md) for optimization, later evidence, and
the private-schema upgrade instructions. Changes remain local and unpushed.

The later optimization qualified 325,000 actors locally for both NORMAL and
CHAOS (three confirmations each), with the unchanged workload. The original
200-actor evidence below remains the preserved correctness baseline, not the
latest capacity result. Use `SPACETIMEDB_DATABASE=one-market-v02-fixed-local`
on the optimization branch to avoid publishing its changed private schema into
an existing baseline world.

## Ready for development

- `crates/market-core`: checked arithmetic, deterministic policy/generator,
  O(K log K) uniform-price clearing, absolute scheduling and evidence validation.
- `crates/spacetime`: bounded setup/reset, indexed bucket actor state, lifecycle,
  atomic settlement/reservations, durable order IDs, private views, CHAOS,
  bounded presentation/evidence and authorized result publication.
- `crates/benchmark`: release Rust SDK harness, fixed offered/viewer load,
  confirmed receipts, post-window conservation audit, three confirmations and
  JSON/CSV exports.
- Generated public TypeScript and private Rust bindings, Docker-backed scripts,
  and CI coverage. Test-only fault controls are excluded from production.

Start/restart with `./scripts/local-up`; open <http://localhost:5173>. The default
`one-market-v02-local` world runs 200 actors. Ordinary startup/publish preserves
existing rows and pause state, including the original `one-market-local` scaffold
database. `local-down` stops services without deleting data or identity volumes.
After runtime edits, use `local-publish` and the checks below. Do not reset a
shared world or remove volumes as a migration shortcut.

Kaleb can build against [client-contract.md](client-contract.md). The existing
observer uses backward-compatible tick/price aliases; human controls, price
charts, capacity presentation and Vercel deployment remain frontend work.

## Executed verification

| Check                     | Observed result                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./scripts/check`         | Passed formatting, lint, TypeScript, Vite build, nine Rust unit tests, WASM/native Clippy, release WASM build and both binding freshness checks                                                       |
| `./scripts/backend-smoke` | Twelve real-runtime tests passed: setup, access/privacy, reservations/replay, scheduler guards, coverage, lifecycle, failure rollback, late/stale scheduling, recovery, and publication authorization |
| `./scripts/smoke`         | Persistent state/single scheduler survived container recreation and republish; both browser shared-state/ping/reconnect tests passed                                                                  |
| Maincloud scripts         | Shell syntax and missing-configuration guards checked; no remote call made                                                                                                                            |

On this host the scripts use
`sudo -n env LOCAL_UID=1000 LOCAL_GID=1000` because Docker access requires it.
The host toolchain is not required. Versions and compatibility observations are
in [versions.md](versions.md).

## Measured local baseline

The final six-run invocation writes to
`artifacts/baseline/20261003T200840Z-2571553/`. Each profile uses 200 actors, seed
20261003, ten production-subscription viewers, five offered human orders/sec,
30-second warm-up and 180-second measurement, repeated three times with fresh
worlds. All six runs PASSED. Every run retained 4,200 committed receipts, including
3,600 measured ticks and exactly 36,000 measured actor updates, with zero skipped
slots, maintained offered/viewer load, healthy confirmed-read clients, and a
passing post-measurement cash/share audit.

| Profile / repeat | P99 start lateness (us) | Policy evaluations | Submitted orders | Filled orders | Matched shares | Accepted / 1,050 offered |
| ---------------- | ----------------------: | -----------------: | ---------------: | ------------: | -------------: | -----------------------: |
| NORMAL 1         |                   2,102 |             29,702 |           34,188 |        19,996 |         87,379 |                      661 |
| NORMAL 2         |                   2,157 |             24,186 |           34,807 |        18,319 |         90,780 |                      663 |
| NORMAL 3         |                   1,868 |             29,607 |           33,995 |        19,721 |         85,649 |                      664 |
| CHAOS 1          |                   2,136 |             14,597 |           33,931 |         8,692 |         38,777 |                      657 |
| CHAOS 2          |                   1,900 |             14,044 |           34,132 |         8,494 |         37,878 |                      664 |
| CHAOS 3          |                   2,045 |             13,989 |           34,168 |         8,305 |         36,627 |                      667 |

Trading/policy columns cover the 180-second measurement window. Offered/accepted
human counts cover all 210 seconds. All offers are retained, including rejected
ones; the generator never lowered its offered rate to match acceptance.

CHAOS kept the actor-write workload intact while producing fewer normal policy
evaluations and fills in these runs. Its measured windows contained
1,785/1,811/1,922 zero-volume ticks, versus 588/101/617 for NORMAL. These are
observations, not a guarantee that shocks always increase settlement work or
cause a crash. Exact lifecycle-transition totals and host execution time are not
present in this artifact version and are not inferred from activity samples.

[NORMAL summary](../artifacts/baseline/20261003T200840Z-2571553/normal/summary.json)
and [CHAOS summary](../artifacts/baseline/20261003T200840Z-2571553/chaos/summary.json)
link all individual JSON-byte hashes; sibling JSON/CSV files retain raw evidence.
Authenticated readback verified a public PASSED LOCAL result in each named
benchmark database: three distinct run IDs, 108,000 measured updates per profile,
zero skips, and worst-repeat P99s of 2,157/2,136 us. Independent artifact checks
also verified each epoch's 200 updates, exact slot/deadline sequence, workload
bytes, build/config agreement, and complete receipt/offer counts.

The final build hash is recorded in [versions.md](versions.md). The run workload
hashes are `f4da5a0f6b328dc010540322f3cf433944ed1c3147f76ebab3318a45be8a012c`
(NORMAL) and `8395149de9d10c7acd1aae0d825c8edc34197457973f1f952411bff070a75234`
(CHAOS). Public summary evidence hashes are
`ba6e28bff75bcc429fef782ac5418638e918bc80b51aecab2eaf98adff2b87e9` and
`1e2e07081fab2b2a13398a500f0d3e598a0c1397884c1ecfc5c9c50da1e414d9`, respectively.

The earlier `20261003T183504Z-2130750/normal/` artifacts are preserved as
preliminary evidence from an older build and older hash format. They are not the
final six-run qualification and must not be mixed with it.

See [methodology](benchmark-methodology.md) for the exact load, qualification,
retention, hashes and timing interpretation. A successful 200-actor run is not a
maximum-capacity search. The local VM exposes 12 logical CPUs on an AMD Ryzen 9
9950X host and is not an exclusive benchmark machine. It does not establish
Maincloud capacity, execution duration or energy consumption.

## Remaining boundary and next work

Maincloud is blocked only on a selected authorized development database and
credentials. The scripts require explicit confirmation, preserve publication
data and refuse an initialized benchmark world. Run the compatibility gate on
the observed managed stack before its own bounded NORMAL/CHAOS qualification.
No service was purchased, shared database overwritten, or cloud stress run made.

The next performance work should be evidence-led:

1. Run a controlled population ladder with the same workload; 200 actors cannot
   locate a saturation knee. Retain failures/inconclusive trials and qualify any
   eventual candidate three times. Do not change load to rescue a result.
2. Profile runtime/database work before optimizing. The hot path already avoids
   full-population selection and quadratic price clearing. Candidate costs are
   due-row decoding/final writes, sorting/digest scratch allocation, public view
   updates and confirmed receipt fan-out; none is yet a measured bottleneck.
3. Record host execution/CPU/energy only with a validated external measurement
   source. Client arrival/RTT and reducer invocation timestamp cannot substitute.
4. Extend exported phase/lifecycle diagnostics before explaining CHAOS costs.
   Current receipts quantify policy, submitted/filled orders and matched shares;
   grant conservation is audited after measurement. Sampled activity is not a
   complete transition count and should not be used as one.
5. Investigate human rate-limit rejection patterns separately from saturation.
   Fixed 200 ms offers can arrive less than 200 ms apart due to transport/runtime
   jitter. The current generator preserves these outcomes rather than retrying
   or reducing the offered rate; any rule change needs a new versioned workload.

No SIMD, unsafe storage, external authoritative actor service, or capacity claim
is justified by this small baseline.
