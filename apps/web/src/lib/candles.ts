import type { PriceSample } from '../market/contract';

/** Bound SVG redraw cost independently of cadence and retained history. */
const MAX_CANDLES = 72;

export interface Candle {
  readonly openCents: bigint;
  readonly highCents: bigint;
  readonly lowCents: bigint;
  readonly closeCents: bigint;
  readonly volume: bigint;
  readonly firstTick: bigint;
  readonly lastTick: bigint;
  readonly atUs: bigint;
}

/**
 * Groups clearings into candles by elapsed time rather than by count, so the
 * candles stay even across a cadence change or a pause.
 *
 * Every figure in a candle is a price the auction actually cleared at: the open
 * is the first clearing in the bucket, the close the last, the high and low the
 * extremes. Nothing is smoothed or interpolated, which is why this is a plain
 * candlestick and not one of the averaged variants.
 */
export function toCandles(samples: readonly PriceSample[]): Candle[] {
  if (samples.length === 0) return [];
  const first = samples[0].recordedAtUs;
  const last = samples[samples.length - 1].recordedAtUs;
  const span = last - first;
  const buckets = Math.min(MAX_CANDLES, samples.length);
  const width = span > 0n ? span / BigInt(buckets) : 0n;

  const grouped = new Map<number, PriceSample[]>();
  samples.forEach((sample, index) => {
    const key =
      width > 0n
        ? Math.min(Number((sample.recordedAtUs - first) / width), buckets - 1)
        : Math.min(Math.floor((index / samples.length) * buckets), buckets - 1);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(sample);
    else grouped.set(key, [sample]);
  });

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, rows]) => {
      let high = rows[0].priceCents;
      let low = rows[0].priceCents;
      let volume = 0n;
      for (const row of rows) {
        if (row.priceCents > high) high = row.priceCents;
        if (row.priceCents < low) low = row.priceCents;
        volume += row.matchedShareVolume;
      }
      return {
        openCents: rows[0].priceCents,
        closeCents: rows[rows.length - 1].priceCents,
        highCents: high,
        lowCents: low,
        volume,
        firstTick: rows[0].logicalTick,
        lastTick: rows[rows.length - 1].logicalTick,
        atUs: rows[0].recordedAtUs,
      };
    });
}
