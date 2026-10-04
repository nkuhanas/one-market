import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  cadenceLabel,
  priceWindow,
  selectCapacity,
} from '../apps/web/src/market/contract.ts';

const ten = { profile: '10hz', tickIntervalUs: 100000n, bucketCount: 20 };

test('durable operating presets match cadence registry and retained evidence', () => {
  const read = (relative) =>
    JSON.parse(
      readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8'),
    );
  const config = read('config/v02.json');
  const record = read('config/operating-presets.json');
  assert.equal(record.environment, 'LOCAL');
  assert.equal(record.apply_automatically, false);
  assert.equal(record.qualification_claim, false);
  assert.deepEqual(
    record.presets.map((p) => [p.cadence_profile, p.actor_population]),
    [
      ['20hz', 375000],
      ['10hz', 750000],
      ['5hz', 1000000],
    ],
  );
  for (const preset of record.presets) {
    const cadence = config.cadence_profiles.find(
      (c) => c.id === preset.cadence_profile,
    );
    assert.ok(cadence);
    assert.ok(
      preset.actor_population > 0 &&
        preset.actor_population <= config.population_max,
    );
    assert.ok(preset.limitations.length > 0 && preset.evidence.length > 0);
    for (const path of preset.evidence) {
      const evidence = read(path);
      assert.equal(evidence.environment, 'LOCAL');
      assert.equal(evidence.population, preset.actor_population);
      assert.equal(evidence.cadence_profile ?? '20hz', preset.cadence_profile);
      assert.equal(
        evidence.tick_interval_us ?? 50000,
        cadence.tick_interval_us,
      );
      assert.equal(evidence.mode, 'EXPLORE');
      assert.equal(evidence.validation.status, 'EXPLORE_PASS');
      assert.equal(evidence.validation.skipped_slots, 0);
      assert.ok(evidence.accounting_audit && evidence.workload_maintained);
      if (preset.cadence_profile !== '20hz')
        assert.equal(evidence.subscriber_count, 3);
    }
  }
});

test('cadence labels are server-derived and absent metadata stays pending', () => {
  assert.equal(cadenceLabel(), 'Cadence pending');
  assert.equal(cadenceLabel(ten), '10 Hz target');
  assert.equal(
    cadenceLabel({ ...ten, profile: '4hz', tickIntervalUs: 250000n }),
    '4 Hz target',
  );
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
