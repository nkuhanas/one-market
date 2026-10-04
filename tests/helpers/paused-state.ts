import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import type { DbConnection } from '../private-bindings';

export interface RuntimeSnapshot {
  logicalTick: bigint;
  enabled: boolean;
  generation: bigint;
  runId: bigint;
  status: string;
  skippedSlots: bigint;
  scheduledTicks: number;
}

export function cachedSnapshot(
  connection: DbConnection,
): RuntimeSnapshot | undefined {
  const market = connection.db.marketState.id.find(0);
  const runtime = connection.db.runtimeConfig.id.find(0);
  const run = runtime && connection.db.runRecord.runId.find(runtime.runId);
  if (!market || !runtime || (!run && runtime.runId !== 0n)) return undefined;
  return {
    logicalTick: market.logicalTick,
    enabled: runtime.enabled,
    generation: runtime.generation,
    runId: runtime.runId,
    status: run?.status ?? 'NONE',
    skippedSlots: run?.skippedSlots ?? 0n,
    scheduledTicks: [...connection.db.tickSchedule.iter()].length,
  };
}

// Read only the small control records, never the actor population. The HTTP SQL
// endpoint is independent of the SDK's long-lived subscription cache.
// The pinned 2.10.1 server rejects multi-statement SQL, despite newer HTTP docs.
// These reads are not an atomic cross-table snapshot. The pause fence verifies
// the stopped state again after cache convergence and throughout observation.
const snapshotQueries = [
  'SELECT logical_tick FROM market_state WHERE id = 0',
  'SELECT enabled, generation, run_id FROM runtime_config WHERE id = 0',
  'SELECT run_id, status, skipped_slots FROM run_record',
  'SELECT scheduled_id FROM tick_schedule',
];

export function parseSnapshot(json: string | string[]): RuntimeSnapshot {
  // Node 24 exposes the original numeric token. Never round a u64 through Number.
  const statements = (Array.isArray(json) ? json : [json]).flatMap((text) =>
    JSON.parse(text, (_key, value, context?: { source: string }) => {
      if (typeof value !== 'number') return value;
      assert(
        context?.source && /^-?\d+$/.test(context.source),
        'integer SQL value required',
      );
      return BigInt(context.source);
    }),
  ) as { rows: unknown[][] }[];
  assert.equal(statements.length, 4, 'four snapshot query results required');
  const [market, runtime, runs, schedule] = statements.map((s) => s.rows);
  assert.equal(market.length, 1, 'market singleton missing');
  assert.equal(runtime.length, 1, 'runtime singleton missing');
  const [enabled, generation, runId] = runtime[0];
  assert.equal(typeof enabled, 'boolean');
  const run = runs.find(([id]) => id === runId);
  assert(
    run || runId === 0n,
    'current run missing from authoritative snapshot',
  );
  if (run) assert.equal(typeof run[1], 'string');
  const u64 = (value: unknown): bigint => {
    assert(
      typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn,
      'u64 required',
    );
    return value;
  };
  return {
    logicalTick: u64(market[0][0]),
    enabled: enabled as boolean,
    generation: u64(generation),
    runId: u64(runId),
    status: run ? (run[1] as string) : 'NONE',
    skippedSlots: run ? u64(run[2]) : 0n,
    scheduledTicks: schedule.length,
  };
}

export async function serverSnapshot(
  uri: string,
  database: string,
  token?: string,
): Promise<RuntimeSnapshot> {
  assert(
    database.startsWith('one-market-v02-test-'),
    'snapshot helper requires an isolated test database',
  );
  const results = await Promise.all(
    snapshotQueries.map(async (query) => {
      const response = await fetch(
        new URL(`/v1/database/${encodeURIComponent(database)}/sql`, uri),
        {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: query,
          signal: AbortSignal.timeout(5000),
        },
      );
      // Do not include credentials, request headers, or arbitrary server bodies in errors.
      assert(
        response.ok,
        `authoritative snapshot query failed (HTTP ${response.status})`,
      );
      return response.text();
    }),
  );
  return parseSnapshot(results);
}

type ServerReader = () => Promise<RuntimeSnapshot>;
type CacheReader = () => RuntimeSnapshot | undefined;
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const printable = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

export async function pauseAndSynchronize(
  pause: () => Promise<unknown>,
  readServer: ServerReader,
  readCache: CacheReader,
  timeoutMs = 5000,
): Promise<RuntimeSnapshot> {
  await pause();
  const expected = await readServer();
  assert.equal(expected.enabled, false, 'authoritative runtime did not pause');
  assert.equal(
    expected.scheduledTicks,
    0,
    'authoritative schedule survived pause',
  );
  assert.equal(
    expected.status,
    'FAILED',
    'authoritative run was not failed by pause',
  );
  assert(expected.runId > 0n, 'an active run is required');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const cached = readCache();
    assert(
      !cached || cached.logicalTick <= expected.logicalTick,
      'cached tick advanced past the authoritative pause boundary',
    );
    if (isDeepStrictEqual(cached, expected)) break;
    assert(
      performance.now() < deadline,
      `pause cache did not converge: server=${printable(expected)} cache=${printable(cached)}`,
    );
    await delay(10);
  }
  // A cache catching up must not hide concurrent authoritative progress.
  assert.deepEqual(
    await readServer(),
    expected,
    'authoritative paused state changed while synchronizing',
  );
  return expected;
}

export async function assertRemainsPaused(
  expected: RuntimeSnapshot,
  readServer: ServerReader,
  readCache: CacheReader,
  observationMs = 150,
): Promise<void> {
  const deadline = performance.now() + observationMs;
  for (;;) {
    assert.deepEqual(
      await readServer(),
      expected,
      'authoritative paused state changed',
    );
    assert.deepEqual(readCache(), expected, 'synchronized pause cache changed');
    if (performance.now() >= deadline) return;
    // This is an observation window for forbidden progress, not a cache-drain sleep.
    await delay(25);
  }
}
