import { centsToDollars, formatCount, formatUsd } from '../lib/units';
import {
  TARGET_HZ,
  type MarketSnapshot,
  type PriceSample,
} from '../market/contract';

const BG_W = 1600;
const BG_H = 420;

/** The live price line, drawn full-bleed behind the hero. */
function backdrop(samples: readonly PriceSample[]) {
  if (samples.length < 2) return undefined;
  const step = Math.max(1, Math.floor(samples.length / 400));
  const points: string[] = [];
  const values: number[] = [];
  for (let i = 0; i < samples.length; i += step) {
    values.push(centsToDollars(samples[i].priceCents, 'price_cents'));
  }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || Math.max(high, 1)) * 0.3;
  const floor = low - pad;
  const ceil = high + pad;
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * BG_W;
    const y = BG_H - ((v - floor) / (ceil - floor)) * BG_H;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  const line = `M${points.join(' L')}`;
  return {
    line,
    area: `${line} L${BG_W},${BG_H} L0,${BG_H} Z`,
    rising: values[values.length - 1] >= values[0],
  };
}

/**
 * The opening view. It reads as a landing page but every figure in it is live,
 * because the product is public and already running: there is nothing to gate
 * and no reason to show a picture of a market instead of the market.
 */
export function Hero({
  snapshot,
  fillRate,
  connected,
  samples,
}: {
  snapshot?: MarketSnapshot;
  fillRate?: number;
  connected: boolean;
  samples: readonly PriceSample[];
}) {
  const bg = backdrop(samples);
  return (
    <section className="hero">
      {bg && (
        <svg
          className={`hero-backdrop ${bg.rising ? 'up' : 'down'}`}
          viewBox={`0 0 ${BG_W} ${BG_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path className="hero-backdrop-area" d={bg.area} />
          <path className="hero-backdrop-line" d={bg.line} />
        </svg>
      )}
      <span className={`hero-flag ${connected ? 'hero-flag-on' : ''}`}>
        {connected ? 'Live now' : 'Connecting'}
      </span>

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

      <p className="hero-tagline">Thousands of autonomous minds. One price.</p>

      <p className="hero-lede">
        A single synthetic market, shared by everyone who opens this page.
        Autonomous policy agents trade it continuously at {TARGET_HZ} times a
        second, and you can trade against them with a synthetic bankroll. Open
        it on another device and you are looking at the same world.
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
      <p className="hero-reassure">
        No sign-up. It is already running, and you are watching the same world
        as everyone else on this page.
      </p>
    </section>
  );
}
