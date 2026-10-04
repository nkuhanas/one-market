import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cadenceLabel,
  priceWindow,
  selectCapacity,
} from '../apps/web/src/market/contract.ts';

const ten = { profile: '10hz', tickIntervalUs: 100000n, bucketCount: 20 };

test('cadence labels are server-derived and absent metadata stays pending', () => {
  assert.equal(cadenceLabel(), 'Cadence pending');
  assert.equal(cadenceLabel(ten), '10 Hz target');
  assert.equal(
    cadenceLabel({ ...ten, profile: '20hz', tickIntervalUs: 50000n }),
    '20 Hz target',
  );
});

test('chart minute windows use timestamps, including profile changes and gaps', () => {
  const sample = (tick, seconds) => ({
    logicalTick: BigInt(tick),
    recordedAtUs: BigInt(seconds) * 1000000n,
    priceCents: 10000n,
    matchedShareVolume: 1n,
  });
  const samples = [sample(1, 1), sample(2, 40), sample(3, 80), sample(4, 100)];
  assert.deepEqual(priceWindow(samples, 60), samples.slice(1));
  assert.deepEqual(priceWindow(samples, 30), samples.slice(2));
  assert.equal(priceWindow(samples, Infinity), samples);
  assert.deepEqual(priceWindow([], 60), []);
});

test('a larger result at another cadence cannot replace this cadence headline', () => {
  const result = {
    actorCount: 375000n,
    tickIntervalUs: 100000n,
    environment: 'LOCAL',
    workloadProfile: 'NORMAL',
    status: 'PASSED',
    completedAt: {},
  };
  const rows = [
    result,
    { ...result, actorCount: 1000000n, tickIntervalUs: 50000n },
    { ...result, actorCount: 2000000n, status: 'FAILED' },
  ];
  assert.equal(selectCapacity(rows).state, 'pending');
  assert.equal(selectCapacity(rows, ten).value.actorCount, 375000n);
  assert.equal(
    selectCapacity([{ ...result, completedAt: undefined }], ten).state,
    'pending',
  );
});
