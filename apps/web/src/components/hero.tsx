import { useMemo } from 'react';
import { toCandles } from '../lib/candles';
import { centsToDollars, formatCount, formatUsd } from '../lib/units';
import {
  cadenceLabel,
  type Cadence,
  type MarketSnapshot,
  type PriceSample,
} from '../market/contract';

const BG_W = 1600;
const BG_H = 420;

/** The same real OHLC candles as the market, drawn behind the hero. */
function backdrop(samples: readonly PriceSample[]) {
  const candles = toCandles(samples);
  if (candles.length < 2) return undefined;
  const low = Math.min(
    ...candles.map((c) => centsToDollars(c.lowCents, 'low_cents')),
  );
  const high = Math.max(
    ...candles.map((c) => centsToDollars(c.highCents, 'high_cents')),
  );
  const pad = (high - low || Math.max(high, 1)) * 0.3;
  const floor = low - pad;
  const ceil = high + pad;
  const y = (cents: bigint) =>
    BG_H -
    ((centsToDollars(cents, 'price_cents') - floor) / (ceil - floor)) * BG_H;
  const slot = BG_W / candles.length;
  const body = Math.max(slot * 0.62, 1);
  return candles.map((candle, i) => {
    const centre = i * slot + slot / 2;
    const open = y(candle.openCents);
    const close = y(candle.closeCents);
    return {
      key: candle.firstTick.toString(),
      centre,
      x: centre - body / 2,
      width: body,
      bodyY: Math.min(open, close),
      bodyH: Math.max(Math.abs(close - open), 1),
      wickTop: y(candle.highCents),
      wickBottom: y(candle.lowCents),
      rising: candle.closeCents >= candle.openCents,
    };
  });
}

/**
 * The opening view. It reads as a landing page but every figure in it is live,
 * because the product is public and already running: there is nothing to gate
 * and no reason to show a picture of a market instead of the market.
 */
export function Hero({
  snapshot,
  cadence,
  fillRate,
  samples,
}: {
  snapshot?: MarketSnapshot;
  cadence?: Cadence;
  fillRate?: number;
  samples: readonly PriceSample[];
}) {
  const bg = useMemo(() => backdrop(samples), [samples]);
  return (
    <section className="hero" data-trail>
      {bg && (
        <svg
          className="hero-backdrop"
          viewBox={`0 0 ${BG_W} ${BG_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {bg.map((candle) => (
            <g
              key={candle.key}
              className={`candle ${candle.rising ? 'candle-up' : 'candle-down'}`}
            >
              <line
                x1={candle.centre}
                x2={candle.centre}
                y1={candle.wickTop}
                y2={candle.wickBottom}
              />
              <rect
                x={candle.x}
                y={candle.bodyY}
                width={candle.width}
                height={candle.bodyH}
              />
            </g>
          ))}
        </svg>
      )}

      <div className="hero-lockup">
        <img
          className="hero-mark"
          src="/one-market-mark.png"
          alt=""
          width={197}
          height={128}
        />
        <h1>One Market</h1>
      </div>

      {/* The population is stated from the live row rather than asserted, so
          the line is exact in whatever world this page is pointed at. */}
      <p className="hero-tagline">
        {snapshot && snapshot.actorCount > 0n
          ? `${formatCount(snapshot.actorCount)} autonomous minds. One price.`
          : 'Autonomous minds. One price.'}
      </p>

      <p className="hero-lede">
        A single synthetic market, shared by everyone who opens this page.
        Autonomous policy agents share a clock ({cadenceLabel(cadence)}), and
        you can trade against them with a synthetic bankroll. Open it on another
        device and you are looking at the same world.
      </p>

      <dl className="hero-stats">
        <div>
          <dt>Last traded</dt>
          <dd className="mono">
            {snapshot ? formatUsd(snapshot.priceCents) : '—'}
          </dd>
        </div>
        <div>
          <dt>Autonomous agents</dt>
          <dd className="mono">
            {snapshot ? formatCount(snapshot.actorCount) : '—'}
          </dd>
        </div>
        <div>
          <dt>Fills per second</dt>
          <dd className="mono">
            {fillRate === undefined
              ? '—'
              : fillRate.toLocaleString('en-US', { maximumFractionDigits: 1 })}
          </dd>
        </div>
        <div>
          <dt>Simulation tick</dt>
          <dd className="mono">
            {snapshot ? formatCount(snapshot.logicalTick) : '—'}
          </dd>
        </div>
      </dl>

      <div className="hero-actions">
        <a className="hero-cta" href="#market">
          Open the market
        </a>
      </div>
    </section>
  );
}
