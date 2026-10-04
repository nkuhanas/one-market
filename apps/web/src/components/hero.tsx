import { formatCount, formatUsd } from '../lib/units';
import { TARGET_HZ, type MarketSnapshot } from '../market/contract';

/**
 * The opening view. It reads as a landing page but every figure in it is live,
 * because the product is public and already running: there is nothing to gate
 * and no reason to show a picture of a market instead of the market.
 */
export function Hero({
  snapshot,
  fillRate,
  connected,
}: {
  snapshot?: MarketSnapshot;
  fillRate?: number;
  connected: boolean;
}) {
  return (
    <section className="hero">
      <span className={`hero-flag ${connected ? 'hero-flag-on' : ''}`}>
        {connected ? 'Live now' : 'Connecting'}
      </span>

      <h1>
        One market.
        <br />
        Thousands of autonomous minds.
      </h1>

      <p className="hero-lede">
        A single synthetic market, shared by everyone who opens this page.
        Autonomous policy actors trade it continuously at {TARGET_HZ} times a
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
          <dt>Autonomous actors</dt>
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
        <a className="hero-link" href="#how">
          How it works
        </a>
      </div>
    </section>
  );
}
