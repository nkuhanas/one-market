import { expect, test } from '@playwright/test';
import {
  assertRemainsPaused,
  parseSnapshot,
  pauseAndSynchronize,
  type RuntimeSnapshot,
} from './helpers/paused-state';

const paused: RuntimeSnapshot = {
  logicalTick: 42n,
  enabled: false,
  generation: 3n,
  runId: 2n,
  status: 'FAILED',
  skippedSlots: 1n,
  scheduledTicks: 0,
};
const noOp = async () => {};
const server = async () => ({ ...paused });

test('pause fence waits for delayed pre-pause ticks, not two equal stale samples', async () => {
  let reads = 0;
  const result = await pauseAndSynchronize(noOp, server, () => {
    reads++;
    return { ...paused, logicalTick: reads < 4 ? 40n : paused.logicalTick };
  });
  expect(reads).toBe(4);
  expect(result).toEqual(paused);
});

test('pause fence independently waits for the delayed run-status update', async () => {
  let reads = 0;
  await pauseAndSynchronize(noOp, server, () => {
    reads++;
    return { ...paused, status: reads < 4 ? 'RUNNING' : 'FAILED' };
  });
  expect(reads).toBe(4);
});

test('pause fence requires matching runtime generation, run ID and schedule', async () => {
  const updates = [
    undefined,
    { ...paused, generation: 2n },
    { ...paused, runId: 1n },
    { ...paused, scheduledTicks: 1 },
    paused,
  ];
  await pauseAndSynchronize(noOp, server, () => updates.shift());
  expect(updates).toHaveLength(0);
});

test('a permanently stale run cache times out without accepting RUNNING', async () => {
  await expect(
    pauseAndSynchronize(
      noOp,
      server,
      () => ({ ...paused, status: 'RUNNING' }),
      30,
    ),
  ).rejects.toThrow('pause cache did not converge');
});

for (const [name, change, error] of [
  ['enabled runtime', { enabled: true }, 'runtime did not pause'],
  ['surviving schedule', { scheduledTicks: 1 }, 'schedule survived pause'],
  ['wrong authoritative status', { status: 'RUNNING' }, 'run was not failed'],
] as const) {
  test(`pause fence rejects ${name} even with an apparently correct cache`, async () => {
    await expect(
      pauseAndSynchronize(
        noOp,
        async () => ({ ...paused, ...change }),
        () => paused,
      ),
    ).rejects.toThrow(error);
  });
}

test('post-pause server progress while the cache synchronizes is rejected', async () => {
  let reads = 0;
  await expect(
    pauseAndSynchronize(
      noOp,
      async () => ({ ...paused, logicalTick: ++reads === 1 ? 42n : 43n }),
      () => paused,
    ),
  ).rejects.toThrow('authoritative paused state changed while synchronizing');
});

test('cached progress beyond the authoritative fence is never tolerated', async () => {
  await expect(
    pauseAndSynchronize(noOp, server, () => ({ ...paused, logicalTick: 43n })),
  ).rejects.toThrow('cached tick advanced');
});

test('pause observation detects real progress despite a frozen client cache', async () => {
  let reads = 0;
  await expect(
    assertRemainsPaused(
      paused,
      async () => ({ ...paused, logicalTick: ++reads === 1 ? 42n : 43n }),
      () => paused,
      100,
    ),
  ).rejects.toThrow('authoritative paused state changed');
});

test('pause fence propagates denied pause/read operations without retrying', async () => {
  let reads = 0;
  const denied = async () => {
    throw new Error('unauthorized');
  };
  await expect(
    pauseAndSynchronize(
      denied,
      async () => {
        reads++;
        return paused;
      },
      () => paused,
    ),
  ).rejects.toThrow('unauthorized');
  expect(reads).toBe(0);
  await expect(pauseAndSynchronize(noOp, denied, () => paused)).rejects.toThrow(
    'unauthorized',
  );
});

test('SQL snapshots preserve all u64 bits and select the current run', () => {
  const snapshot = parseSnapshot(`[
    {"rows":[[18446744073709551615]]},
    {"rows":[[false,18446744073709551615,2]]},
    {"rows":[[1,"RUNNING",0],[2,"FAILED",9007199254740993]]},
    {"rows":[]}
  ]`);
  expect(snapshot).toEqual({
    ...paused,
    logicalTick: 0xffffffffffffffffn,
    generation: 0xffffffffffffffffn,
    skippedSlots: 9007199254740993n,
  });
});

test('paused adoption can leave no current run without hiding missing evidence', () => {
  const rows = (run: number) =>
    JSON.stringify([
      { rows: [[42]] },
      { rows: [[false, 4, run]] },
      { rows: [[2, 'FAILED', 1]] },
      { rows: [] },
    ]);
  expect(parseSnapshot(rows(0))).toEqual({
    ...paused,
    generation: 4n,
    runId: 0n,
    status: 'NONE',
    skippedSlots: 0n,
  });
  expect(() => parseSnapshot(rows(3))).toThrow('current run missing');
});
