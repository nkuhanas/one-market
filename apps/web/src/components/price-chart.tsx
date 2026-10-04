import { memo, useMemo, useState } from 'react';
import { centsToDollars, formatCount, formatUsd } from '../lib/units';
import { priceWindow, type PriceSample } from '../market/contract';
import { EmptyState } from './value';

const VIEW_W = 1000;
const VIEW_H = 320;
/** The lower band of the plot is given over to volume. */
const VOLUME_H = 72;
const PRICE_H = VIEW_H - VOLUME_H;
/** Candles are bucketed to this many, so redraw cost is independent of cadence. */
const MAX_CANDLES = 72;

export const RANGES = [
  { id: 'live', label: 'Live', seconds: 30 },
  { id: '1m', label: '1M', seconds: 60 },
  { id: '5m', label: '5M', seconds: 300 },
  { id: 'all', label: 'All', seconds: Number.POSITIVE_INFINITY },
] as const;

export type RangeId = (typeof RANGES)[number]['id'];

export interface ChartStat {
  readonly label: string;
  readonly value: string;
}

interface Candle {
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
function toCandles(samples: readonly PriceSample[]): Candle[] {
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

export const PriceChart = memo(function PriceChart({
  samples,
  range,
  onRange,
  stats = [],
}: {
  samples: readonly PriceSample[];
  range: RangeId;
  onRange: (id: RangeId) => void;
  stats?: readonly ChartStat[];
}) {
  const [cursor, setCursor] = useState<number>();
  const window = RANGES.find((r) => r.id === range)!.seconds;
  const scoped = useMemo(() => priceWindow(samples, window), [samples, window]);

  const plot = useMemo(() => {
    const candles = toCandles(scoped);
    if (candles.length < 2) return undefined;

    const highs = candles.map((c) => centsToDollars(c.highCents, 'high_cents'));
    const lows = candles.map((c) => centsToDollars(c.lowCents, 'low_cents'));
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    // A market that never moves is a valid outcome, so a flat series is centred
    // rather than divided by a zero range.
    const flat = high === low;
    const pad = (high - low || Math.max(high, 1)) * 0.12;
    const floor = low - pad;
    const ceil = high + pad;
    const y = (dollars: number) =>
      PRICE_H - ((dollars - floor) / (ceil - floor)) * PRICE_H;

    const slot = VIEW_W / candles.length;
    const body = Math.max(slot * 0.62, 1);
    const volumes = candles.map((c) => Number(c.volume));
    const peak = Math.max(...volumes, 1);

    const drawn = candles.map((candle, i) => {
      const o = centsToDollars(candle.openCents, 'open_cents');
      const c = centsToDollars(candle.closeCents, 'close_cents');
      const centre = i * slot + slot / 2;
      const top = y(Math.max(o, c));
      const bottom = y(Math.min(o, c));
      return {
        candle,
        centre,
        x: centre - body / 2,
        w: body,
        // A doji still needs a visible mark, so the body has a floor of 1px.
        bodyY: top,
        bodyH: Math.max(bottom - top, 1),
        wickTop: y(centsToDollars(candle.highCents, 'high_cents')),
        wickBottom: y(centsToDollars(candle.lowCents, 'low_cents')),
        rising: c >= o,
        volH: (Number(candle.volume) / peak) * VOLUME_H,
      };
    });

    return {
      drawn,
      slot,
      flat,
      low,
      high,
      peak,
      traded: volumes.some((v) => v > 0),
      first: candles[0],
      last: candles[candles.length - 1],
      rising: candles[candles.length - 1].closeCents >= candles[0].openCents,
    };
  }, [scoped]);

  const active = cursor !== undefined ? plot?.drawn[cursor] : undefined;

  return (
    <section className="chart-card">
      <div className="chart-head">
        <div>
          <h2>Price history</h2>
          <p className="chart-source">
            {plot
              ? `${plot.drawn.length} candles from ${formatCount(BigInt(scoped.length))} clearings`
              : 'Server price feed'}
          </p>
        </div>
        <div className="range" role="group" aria-label="Chart range">
          {RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={option.id === range ? 'range-on' : ''}
              aria-pressed={option.id === range}
              onClick={() => onRange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {plot ? (
        <>
          <div className="chart-body">
            <div
              className="plot"
              role="img"
              tabIndex={0}
              aria-label={`Candlestick price history, ${plot.drawn.length} candles, ${formatUsd(plot.first.openCents)} to ${formatUsd(plot.last.closeCents)}, ${plot.flat ? 'unchanged' : plot.rising ? 'rising' : 'falling'}`}
              onMouseLeave={() => setCursor(undefined)}
              onBlur={() => setCursor(undefined)}
              onMouseMove={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - box.left) / box.width;
                setCursor(
                  Math.min(
                    plot.drawn.length - 1,
                    Math.max(0, Math.floor(ratio * plot.drawn.length)),
                  ),
                );
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
                  return;
                event.preventDefault();
                const step = event.key === 'ArrowLeft' ? -1 : 1;
                setCursor((current) => {
                  const base = current ?? plot.drawn.length - 1;
                  return Math.min(
                    plot.drawn.length - 1,
                    Math.max(0, base + step),
                  );
                });
              }}
            >
              <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {plot.drawn.map((d, i) => (
                  <g
                    key={i}
                    className={`candle ${d.rising ? 'candle-up' : 'candle-down'}`}
                  >
                    <line
                      x1={d.centre}
                      x2={d.centre}
                      y1={d.wickTop}
                      y2={d.wickBottom}
                    />
                    <rect x={d.x} y={d.bodyY} width={d.w} height={d.bodyH} />
                    <rect
                      className="candle-volume"
                      x={d.x}
                      y={VIEW_H - d.volH}
                      width={d.w}
                      height={d.volH}
                    />
                  </g>
                ))}
              </svg>

              {active && (
                <div
                  className="crosshair"
                  style={{ left: `${(active.centre / VIEW_W) * 100}%` }}
                  aria-hidden="true"
                />
              )}
              {active && (
                <p className="readout" aria-live="polite" aria-atomic="true">
                  <span className="mono">
                    O {formatUsd(active.candle.openCents)}
                  </span>
                  <span className="mono">
                    H {formatUsd(active.candle.highCents)}
                  </span>
                  <span className="mono">
                    L {formatUsd(active.candle.lowCents)}
                  </span>
                  <span className="mono">
                    C {formatUsd(active.candle.closeCents)}
                  </span>
                  <span className="mono">
                    {formatCount(active.candle.volume)} sh
                  </span>
                </p>
              )}
            </div>

            <div className="chart-scale">
              <span>{formatUsd(BigInt(Math.round(plot.high * 100)))}</span>
              <span>{formatUsd(BigInt(Math.round(plot.low * 100)))}</span>
              <span className="chart-scale-volume">
                {plot.traded
                  ? `${formatCount(BigInt(plot.peak))} sh`
                  : 'no volume'}
              </span>
            </div>
          </div>

          {stats.length > 0 && (
            <dl className="chart-stats">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt>{stat.label}</dt>
                  <dd className="mono">{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="chart-foot">
            <span>
              Tick {formatCount(plot.first.firstTick)} →{' '}
              {formatCount(plot.last.lastTick)}
            </span>
            <span>Per-second figures observed by this browser</span>
          </div>
        </>
      ) : (
        <EmptyState
          title="Waiting for the price feed"
          body="Each cleared tick writes a point here. Candles form as soon as the runtime records them."
        />
      )}
    </section>
  );
});
