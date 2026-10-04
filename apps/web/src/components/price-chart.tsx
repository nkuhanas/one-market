import { memo, useMemo } from 'react';
import { centsToDollars, formatCount, formatUsd } from '../lib/units';
import { priceWindow, type PriceSample } from '../market/contract';
import { EmptyState } from './value';

const VIEW_W = 1000;
const VIEW_H = 320;
/** Capped so redraw cost is independent of runtime cadence. */
const MAX_POINTS = 320;

export const RANGES = [
  { id: 'live', label: 'Live', seconds: 30 },
  { id: '1m', label: '1M', seconds: 60 },
  { id: '5m', label: '5M', seconds: 300 },
  { id: 'all', label: 'All', seconds: Number.POSITIVE_INFINITY },
] as const;

export type RangeId = (typeof RANGES)[number]['id'];

function downsample(samples: readonly PriceSample[]): PriceSample[] {
  if (samples.length <= MAX_POINTS) return [...samples];
  const stride = samples.length / MAX_POINTS;
  const out: PriceSample[] = [];
  for (let i = 0; i < MAX_POINTS; i += 1)
    out.push(samples[Math.floor(i * stride)]);
  const last = samples[samples.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export const PriceChart = memo(function PriceChart({
  samples,
  range,
  onRange,
}: {
  samples: readonly PriceSample[];
  range: RangeId;
  onRange: (id: RangeId) => void;
}) {
  const window = RANGES.find((r) => r.id === range)!.seconds;
  const scoped = useMemo(() => priceWindow(samples, window), [samples, window]);

  const plot = useMemo(() => {
    const drawn = downsample(scoped);
    if (drawn.length < 2) return undefined;
    const values = drawn.map((s) =>
      centsToDollars(s.priceCents, 'price_cents'),
    );
    const low = Math.min(...values);
    const high = Math.max(...values);
    // A market that never clears is a valid outcome, so a flat series is
    // centred rather than divided by a zero range.
    const flat = high === low;
    const pad = (high - low || Math.max(high, 1)) * 0.15;
    const floor = low - pad;
    const ceil = high + pad;
    const pts = values.map((v, i) => {
      const elapsed =
        drawn[drawn.length - 1].recordedAtUs - drawn[0].recordedAtUs;
      const x =
        elapsed > 0n
          ? (Number(
              ((drawn[i].recordedAtUs - drawn[0].recordedAtUs) * 1_000_000n) /
                elapsed,
            ) /
              1_000_000) *
            VIEW_W
          : (i / (values.length - 1)) * VIEW_W;
      const y = VIEW_H - ((v - floor) / (ceil - floor)) * VIEW_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M${pts.join(' L')}`;
    return {
      line,
      area: `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`,
      flat,
      low,
      high,
      rising: values[values.length - 1] > values[0],
      first: drawn[0],
      last: drawn[drawn.length - 1],
    };
  }, [scoped]);

  return (
    <section className="chart-card">
      <div className="chart-head">
        <div>
          <h2>Price history</h2>
          <p className="chart-source">
            {plot
              ? `${formatCount(BigInt(scoped.length))} ticks from the server price feed`
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
            <svg
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`Price from ${formatUsd(plot.first.priceCents)} to ${formatUsd(plot.last.priceCents)} across ${scoped.length} ticks`}
              className={plot.flat ? 'flat' : plot.rising ? 'up' : 'down'}
            >
              <path className="chart-area" d={plot.area} />
              <path className="chart-line" d={plot.line} />
            </svg>
            <div className="chart-scale">
              <span>{formatUsd(BigInt(Math.round(plot.high * 100)))}</span>
              <span>{formatUsd(BigInt(Math.round(plot.low * 100)))}</span>
            </div>
          </div>
          <div className="chart-foot">
            <span>
              Tick {formatCount(plot.first.logicalTick)} →{' '}
              {formatCount(plot.last.logicalTick)}
            </span>
            {plot.flat && <span>Price held flat across this range</span>}
          </div>
        </>
      ) : (
        <EmptyState
          title="Waiting for the price feed"
          body="Each cleared tick writes a point here. The line begins as soon as the runtime records one."
        />
      )}
    </section>
  );
});
