import { useState } from 'react';
import { useScrollReveal } from '../lib/use-reveal';
import { formatCount } from '../lib/units';
import {
  DEMO_ACTIVITY,
  DEMO_ACTORS,
  DEMO_CADENCE,
  DEMO_LIFECYCLE,
  DEMO_PRICES,
  DEMO_SNAPSHOT,
} from '../market/static-demo';
import { ActivityFeed } from './activity-feed';
import { ActorsPanel } from './actors-panel';
import { CursorTrail } from './cursor-trail';
import { Explainer } from './explainer';
import { Header } from './header';
import { Hero } from './hero';
import { KillFeed } from './kill-feed';
import { MarketHeader } from './market-header';
import { PriceChart, type RangeId } from './price-chart';
import { Metric } from './value';

const LOCAL_GUIDE = 'https://github.com/nkuhanas/one-market#quick-start';

/** A read-only, fixed portfolio demo. No database hook or reducer controls. */
export function StaticMarketDemo() {
  useScrollReveal();
  const [range, setRange] = useState<RangeId>('all');
  return (
    <div className="app app-static">
      <CursorTrail />
      <Header status="Disconnected" staticDemo />
      <main>
        <section className="demo-notice" aria-labelledby="demo-notice-title">
          <div>
            <p className="demo-label">Static demo · hosted market offline</p>
            <h2 id="demo-notice-title">
              The live production market is down due to compute costs.
            </h2>
            <p>
              Explore the interface with illustrative static data below. Prices,
              agents and events are examples, not live results or benchmark
              evidence. Trading and CHAOS are available when you run it locally.
            </p>
          </div>
          <a className="hero-cta" href={LOCAL_GUIDE}>
            Try it locally
          </a>
        </section>
        <Hero snapshot={DEMO_SNAPSHOT} samples={DEMO_PRICES} staticDemo />
        <MarketHeader snapshot={DEMO_SNAPSHOT} staticDemo />
        <div className="trading">
          <PriceChart
            samples={DEMO_PRICES}
            range={range}
            onRange={setRange}
            snapshot={DEMO_SNAPSHOT}
            cadence={DEMO_CADENCE}
            staticDemo
          />
          <aside
            className="order local-demo"
            aria-labelledby="local-demo-title"
          >
            <div className="order-head">
              <h2 id="local-demo-title">Run your own market</h2>
            </div>
            <p>
              Start with 200 agents on your machine. The same Rust market,
              auctions, human trading and CHAOS run locally with Docker.
            </p>
            <pre className="mono">
              <code>{`git clone https://github.com/nkuhanas/one-market.git
cd one-market
./scripts/local-up`}</code>
            </pre>
            <p>
              Open <code>http://localhost:5173</code>. You need Git and Docker
              Compose; host Node and Rust installations are not required.
            </p>
            <a className="hero-cta" href={LOCAL_GUIDE}>
              Local setup guide
            </a>
            <p className="order-note">
              This hosted demo is read-only. No market connection is opened and
              no orders are submitted.
            </p>
          </aside>
        </div>
        <section
          className="metrics"
          aria-label="Illustrative demo statistics"
          data-reveal
        >
          <Metric
            label="Example agent population"
            value={{
              state: 'sample',
              value: formatCount(DEMO_SNAPSHOT.actorCount),
            }}
            hint="Illustrative population, not a capacity claim"
            tone="accent"
          />
          <Metric
            label="Example active agents"
            value={{
              state: 'sample',
              value: formatCount(DEMO_SNAPSHOT.activeActorCount),
            }}
            hint="Fixed demo data"
          />
          <Metric
            label="Hosted market"
            value={{ state: 'sample', value: 'Offline' }}
            hint="Down due to compute costs"
          />
          <Metric
            label="Local default"
            value={{ state: 'sample', value: '200 agents' }}
            hint="A lightweight starting population"
          />
          <Metric
            label="Demo data"
            value={{ state: 'sample', value: 'Static' }}
            hint="Illustrative, not a recorded run"
          />
        </section>
        <div className="panels" data-reveal>
          <ActivityFeed activity={DEMO_ACTIVITY} staticDemo />
          <KillFeed kills={DEMO_LIFECYCLE} staticDemo />
          <ActorsPanel
            actors={DEMO_ACTORS}
            actorCount={DEMO_SNAPSHOT.actorCount}
          />
        </div>
        <Explainer cadence={DEMO_CADENCE} staticDemo />
        <section className="system" id="system">
          <p className="system-line">
            Static demo · runtime offline · run locally to trade and trigger
            CHAOS.
          </p>
        </section>
      </main>
    </div>
  );
}
