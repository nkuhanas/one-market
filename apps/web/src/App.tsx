import { useState } from 'react';
import { ActivityFeed } from './components/activity-feed';
import { ActorsPanel } from './components/actors-panel';
import { ChaosBanner } from './components/chaos-banner';
import { CursorTrail } from './components/cursor-trail';
import { Explainer } from './components/explainer';
import { Hero } from './components/hero';
import { KillFeed } from './components/kill-feed';
import { Header } from './components/header';
import { MarketHeader } from './components/market-header';
import { OrderPanel } from './components/order-panel';
import { PriceChart, type RangeId } from './components/price-chart';
import { SystemStatus } from './components/system-status';
import { Metric } from './components/value';
import { formatCount } from './lib/units';
import { live, pending } from './market/contract';
import { useScrollReveal } from './lib/use-reveal';
import { useRates } from './market/use-rates';
import { useOneMarket } from './market/use-one-market';

export function App() {
  const market = useOneMarket();
  useScrollReveal();
  const [range, setRange] = useState<RangeId>('live');
  const { snapshot } = market;

  // A rate has to come from the change in a counter over elapsed time. The
  // cumulative total is not a rate, and the runtime does not publish the
  // counter's value at the window start, so this browser measures it itself.
  const rates = useRates(
    snapshot
      ? {
          stepped: snapshot.cumulativeActorSteps,
          decided: snapshot.cumulativePolicyEvaluations,
          submitted: snapshot.cumulativeOrdersSubmitted,
          filled: snapshot.cumulativeOrdersFilled,
          volume: snapshot.cumulativeMatchedShareVolume,
        }
      : undefined,
  );
  const fillRate = rates.filled;

  const perSecond = (value?: number) =>
    value === undefined
      ? '—'
      : value.toLocaleString('en-US', {
          maximumFractionDigits: value < 10 ? 1 : 0,
        });

  const chartStats = [
    { label: 'Agents stepped / sec', value: perSecond(rates.stepped) },
    { label: 'Agents that acted / sec', value: perSecond(rates.decided) },
    { label: 'Orders placed / sec', value: perSecond(rates.submitted) },
    { label: 'Orders filled / sec', value: perSecond(rates.filled) },
    { label: 'Shares traded / sec', value: perSecond(rates.volume) },
  ];

  return (
    <div className={`app ${market.shock ? 'app-chaos' : ''}`}>
      <CursorTrail />

      <Header
        status={market.status}
        logicalTick={snapshot?.logicalTick}
        cadence={market.cadence}
      />

      <main>
        {market.shock && <ChaosBanner shock={market.shock} />}

        <Hero
          snapshot={snapshot}
          cadence={market.cadence}
          fillRate={fillRate}
          samples={market.priceHistory}
        />

        <MarketHeader snapshot={snapshot} />

        <div className="trading">
          <PriceChart
            samples={market.priceHistory}
            range={range}
            onRange={setRange}
            stats={chartStats}
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

        <section className="metrics" aria-label="Market statistics" data-reveal>
          <Metric
            label="Autonomous agents"
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

        <div className="panels" data-reveal>
          <ActivityFeed activity={market.activity} />
          <KillFeed kills={market.kills} />
          <ActorsPanel
            actors={market.actors}
            actorCount={snapshot?.actorCount}
          />
        </div>

        <Explainer cadence={market.cadence} />

        <SystemStatus
          snapshot={snapshot}
          cadence={market.cadence}
          status={market.status}
          error={market.error}
          pricePoints={market.priceHistory.length}
          onPing={market.ping}
          onTriggerChaos={market.triggerChaos}
          onReconnect={market.reconnect}
        />
      </main>
    </div>
  );
}
