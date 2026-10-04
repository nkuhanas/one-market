import { useState } from 'react';
import { ActivityFeed } from './components/activity-feed';
import { ActorsPanel } from './components/actors-panel';
import { ChaosBanner } from './components/chaos-banner';
import { Explainer } from './components/explainer';
import { Hero } from './components/hero';
import { Header } from './components/header';
import { MarketHeader } from './components/market-header';
import { OrderPanel } from './components/order-panel';
import { PriceChart, type RangeId } from './components/price-chart';
import { SystemStatus } from './components/system-status';
import { Metric } from './components/value';
import { formatCount } from './lib/units';
import { live, pending, TARGET_HZ } from './market/contract';
import { useFillRate } from './market/use-fill-rate';
import { useOneMarket } from './market/use-one-market';

export function App() {
  const market = useOneMarket();
  const [range, setRange] = useState<RangeId>('live');
  const { snapshot } = market;

  // A rate has to come from the change in a counter over elapsed time. The
  // cumulative total is not a rate, and the runtime does not publish the
  // counter's value at the window start, so this browser measures it itself.
  const fillRate = useFillRate(snapshot?.cumulativeOrdersFilled);

  return (
    <div className={`app ${market.shock ? 'app-chaos' : ''}`}>
      <Header status={market.status} logicalTick={snapshot?.logicalTick} />

      <main>
        {market.shock && <ChaosBanner shock={market.shock} />}

        <Hero
          snapshot={snapshot}
          fillRate={fillRate}
          connected={market.status === 'Connected'}
        />

        <MarketHeader snapshot={snapshot} />

        <div className="trading">
          <PriceChart
            samples={market.priceHistory}
            range={range}
            onRange={setRange}
          />
          <OrderPanel
            snapshot={snapshot}
            trader={market.trader}
            pendingOrder={market.pendingOrder}
            fills={market.fills}
            connected={market.status === 'Connected'}
            onEnter={market.enterMarket}
            onPlace={market.placeOrder}
          />
        </div>

        <section className="metrics" aria-label="Market statistics">
          <Metric
            label="Autonomous actors"
            value={
              snapshot
                ? live(formatCount(snapshot.actorCount))
                : pending('Connecting')
            }
            hint={
              snapshot
                ? `${formatCount(snapshot.activeActorCount)} trading now`
                : undefined
            }
            tone="accent"
          />
          <Metric
            label="Fills / sec"
            value={
              fillRate === undefined
                ? pending('Measuring')
                : live(
                    fillRate.toLocaleString('en-US', {
                      maximumFractionDigits: 1,
                    }),
                  )
            }
            hint="Observed by this browser from counter deltas"
          />
          <Metric
            label="Connected identities"
            value={
              snapshot
                ? live(formatCount(snapshot.connectedIdentityCount))
                : pending('Connecting')
            }
            hint="Distinct browsers watching this world"
          />
          <Metric
            label="Humans trading"
            value={
              snapshot
                ? live(formatCount(snapshot.registeredHumanTraderCount))
                : pending('Connecting')
            }
          />
          <Metric
            label="Verified capacity"
            value={
              market.capacity.state === 'live'
                ? live(
                    `${formatCount(market.capacity.value.actorCount)} @ ${Math.round(
                      1_000_000 / Number(market.capacity.value.tickIntervalUs),
                    )} Hz`,
                  )
                : market.capacity
            }
            hint={
              market.capacity.state === 'live'
                ? `${market.capacity.value.environment} · ${market.capacity.value.workloadProfile}`
                : `Never taken from the live population`
            }
          />
        </section>

        <div className="panels">
          <ActivityFeed activity={market.activity} />
          <ActorsPanel
            actors={market.actors}
            actorCount={snapshot?.actorCount}
          />
        </div>

        <Explainer />

        <SystemStatus
          snapshot={snapshot}
          status={market.status}
          error={market.error}
          pricePoints={market.priceHistory.length}
          onPing={market.ping}
          onReconnect={market.reconnect}
        />
      </main>

      <footer className="foot">
        <span>One Market · one persistent synthetic world</span>
        <span>All money is synthetic. {TARGET_HZ} Hz target cadence.</span>
      </footer>
    </div>
  );
}
