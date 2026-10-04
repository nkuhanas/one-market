# Local disk cleanup — 2026-10-04

After recording the user's corrected [operating presets](../operating-presets.md)
(20 Hz / 375k, 10 Hz / 750k, 5 Hz / 1M), clean up this investigation's disposable
local databases and regenerable caches. No deployment, population change, global
Docker prune, or deletion of older worlds was performed.

## Preserved evidence and deletion preflight

The seven cadence probes were already archived in commit `86a5d4f`. At
05:47:36 UTC, authenticated read-only checks against **`http://db:3000`** verified
every target's exact name and identity, owner access, paused state, zero scheduled
ticks, population, run ID, build/workload hashes, and final tick against the
archived receipts. All were non-qualifying exploratory worlds. Artifact SHA-256
values were captured before deletion and matched afterward; the raw files remain
unchanged in Git, including the failed and interrupted probes.

Archive roots below are under `artifacts/exploration/`. Each database name is
`one-market-explore-<workload>-<lowercase archive>`. The retained evidence is
`<archive>/<workload>/normal-1.json`, its summary, workload bytes, metrics and any
cancellation note. These are **benchmark evidence, not full database backups**.

| Archive                    | Workload              | Final tick | Removed replica |
| -------------------------- | --------------------- | ---------: | --------------: |
| `20261004T052510Z-1124853` | `10hz-375000-normal`  |        400 |        30000001 |
| `20261004T052607Z-1129646` | `10hz-750000-normal`  |        401 |        30000003 |
| `20261004T052924Z-1146118` | `10hz-1000000-normal` |        322 |        30000005 |
| `20261004T053019Z-1150777` | `10hz-875000-normal`  |        370 |        30000007 |
| `20261004T053117Z-1155657` | `10hz-750000-normal`  |        401 |        30000009 |
| `20261004T053209Z-1160117` | `10hz-812500-normal`  |        364 |        30000011 |
| `20261004T053329Z-1166856` | `5hz-1000000-normal`  |       1050 |        30000013 |

Exact database identities, mapped to replica IDs by the local server's shutdown
logs (not inferred from directory numbering):

```text
30000001 c2006cd0327bd196852080af3d59cac52bd9d4dae6442c179b5d0a3959e6d6ff
30000003 c200c343c1e2522973cc938bcff66db86c673adff3f33f21579bf482de062199
30000005 c200490555405ddb44c4ca03713989b45309f9a0edb1801013968ef7c663d755
30000007 c2001ec1898131aa4f023a36c22f6dd77590240803e4af4301ac79a26a5bce75
30000009 c200102ddb8c3387ade7313c5e3097e9b28ef27b2ab78599f0802614d84a659f
30000011 c200bb05180b1621f673cd2092b2e3e01710c137b30027af9e954c799e0d95d2
30000013 c20040105f314161fb010688103c34b0444db49d0789167b0788ca8454a278e9
```

## Actions and recovery limits

1. Deleted those seven databases by their resolved identities using the local
   SpacetimeDB CLI at 05:48:22–24 UTC. All commands succeeded; the registrations
   disappeared from the owner's database list. Maincloud was never a target.
2. Observed that this deletion left their replica directories and some open log
   handles behind. The server log explicitly confirmed each identity/replica
   pairing, module exit and released database lock. Resolved all seven real paths
   under `/var/lib/docker/volumes/one-market_db-data/_data/replicas/`.
3. Stopped only `one-market-db-1` with a 30-second timeout. Docker reported exit
   137 after that timeout; PID was zero and a subsequent open-file check found
   no handles in the seven directories. Removed only those seven explicit
   paths, without wildcards or deleting the database volume. They occupied
   17,726,758,912 allocated bytes (about 16.5 GiB). Restarted the local service;
   its health check passed and all 17 other databases listed for the current
   authenticated owner were still registered. Older identities/worlds were left
   untouched as well.
4. Ran Cargo's dry-run, then `cargo clean --profile dev` with the explicit target
   directory `/workspace/target` in the tools container: 5,181 files / 2.0 GiB
   reported removed from the named build-cache volume. Release outputs were
   preserved.
5. Removed only two inspected, stopped test-browser containers:
   `one-market-cadence-browser-20261004` and
   `one-market-maincloud-browser-20261004-0359`. No force or volume removal was
   used; their mounted project, dependency and credential volumes remain.

The seven deleted worlds' exact actor rows and transaction histories are **not
recoverable from retained benchmark artifacts**. Their workloads can be rerun
from the frozen modules and archived settings, but that is a new run, not a
restoration. Debug build outputs and browser containers are regenerable.

## Space and verification

Filesystem measurements (`df -B1`, approximately 05:47–05:53 UTC):

|                 |          Before |           After |
| --------------- | --------------: | --------------: |
| Used bytes      | 492,032,630,784 | 472,292,769,792 |
| Available bytes |  19,435,892,736 |  39,175,753,728 |
| Utilization     |             97% |             93% |

Net available-space increase: **19,739,860,992 bytes / about 18.4 GiB**. Other
host activity can slightly affect this filesystem-level measurement. The local
database volume still occupies roughly **157 GiB**, mostly older retained
worlds; this was a scoped first cleanup, not permission to discard those worlds.

- The preset/config/test change passed the full Docker-backed `scripts/check`
  before cache cleanup. All 13 Node tests passed again afterward, including
  retained-evidence validation for every preset.
- No source runtime, lifecycle or integration behavior changed during cleanup;
  a new full browser smoke run was not needed. Local DB health and retained
  registrations were checked after restart. The retained final-smoke fixture
  could still be read: 200 actors, paused, zero scheduled ticks, logical tick 949.
- Release harness remained available. Both the built release WASM and retained
  `artifacts/builds/cadence-profiles/8f763839d849afe0.wasm` still have SHA-256
  `8f763839d849afe0481c2fcfe817aec1c2a6f1a16fd134c9c3eabd2c726b8072`.
- Raw artifacts, `SPEC.md` and compiled `config/v02.json` were unchanged. No
  credentials, `.env`, CLI identities, npm dependencies, Cargo registry downloads
  or unrelated services were deleted. No global image/volume pruning was performed.
- A subsequent read-only Maincloud status check confirmed the existing 100k
  world remains paused at tick 85,475 with zero scheduled ticks and all 100,000
  actors active. Its historical failed-run status is unchanged; cleanup did not
  recover or restart it. Vercel and Maincloud were not deployed.

Future cleanup must resolve and inspect its own exact database targets. Replica
numbers and the local volume path here are a historical audit, not a reusable
deletion allowlist.
