import assert from 'node:assert/strict';
import test from 'node:test';
import { toCandles } from '../apps/web/src/lib/candles.ts';

const sample = (tick, price, at = tick * 250000, volume = 1n) => ({
  logicalTick: BigInt(tick),
  recordedAtUs: BigInt(at),
  priceCents: BigInt(price),
  matchedShareVolume: volume,
});

test('empty, single and flat histories do not invent prices', () => {
  assert.deepEqual(toCandles([]), []);
  for (const rows of [
    [sample(1, 10000)],
    Array.from({ length: 200 }, (_, i) => sample(i, 10000)),
  ]) {
    const candles = toCandles(rows);
    assert.ok(candles.length > 0 && candles.length <= 72);
    for (const candle of candles) {
      for (const field of ['openCents', 'highCents', 'lowCents', 'closeCents'])
        assert.equal(candle[field], 10000n);
    }
    assert.equal(
      candles.reduce((sum, c) => sum + c.volume, 0n),
      BigInt(rows.length),
    );
  }
});

test('shared candles preserve actual OHLC, volume and last clearing', () => {
  const prices = [10000, 10300, 9900, 10100];
  const rows = Array.from({ length: 288 }, (_, i) =>
    sample(i, prices[i % prices.length], i * 1000000, 9007199254740993n),
  );
  const candles = toCandles(rows);
  assert.equal(candles.length, 72);
  assert.deepEqual(candles[0], {
    openCents: 10000n,
    highCents: 10300n,
    lowCents: 9900n,
    closeCents: 10100n,
    volume: 36028797018963972n,
    firstTick: 0n,
    lastTick: 3n,
    atUs: 0n,
  });
  assert.equal(candles.at(-1).closeCents, rows.at(-1).priceCents);
  assert.equal(candles.at(-1).lastTick, rows.at(-1).logicalTick);
  assert.equal(
    candles.reduce((sum, c) => sum + c.volume, 0n),
    288n * rows[0].matchedShareVolume,
  );
});

test('time buckets handle cadence changes, gaps and identical timestamps', () => {
  const candles = toCandles([
    sample(1, 10000, 0),
    sample(2, 9900, 50000),
    sample(3, 10200, 300000),
    sample(4, 10100, 120000000),
  ]);
  assert.equal(candles.length, 2);
  assert.equal(candles[0].closeCents, 10200n);
  assert.equal(candles[0].lowCents, 9900n);
  assert.equal(candles[1].atUs, 120000000n);
  const sameTime = toCandles(
    Array.from({ length: 200 }, (_, i) => sample(i, i + 1, 0)),
  );
  assert.equal(sameTime.length, 72);
  assert.equal(sameTime[0].openCents, 1n);
  assert.equal(sameTime.at(-1).closeCents, 200n);
});
