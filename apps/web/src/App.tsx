import { useState } from 'react';
import { priceChartView } from './charts/price-chart';
import { ActivityTape } from './components/activity-tape';
import { Channel } from './components/channel';
import { ChaosBanner } from './components/chaos-banner';
import { EpochMeter } from './components/epoch-meter';
import { TradePanel } from './components/trade-panel';
import { previewOverrides } from './dev/preview';
import {
  live,
  mapPending,
  pending,
  TARGET_HZ,
  TICKS_PER_EPOCH,
  type Pending,
} from './market/contract';
import { useLiveMarket } from './market/use-live-market';
import { formatCount, formatUsd } from './lib/units';

const WAITING: Pending<never> = pending('Waiting for the shared clock');

export function App() {
  const {
    snapshot,
    priceHistory,
    priceHistoryIsClientObserved,
    verifiedCapacity,
    news: liveNews,
    activity: liveActivity,
    status,
    error,
    ping,
    reconnect,
  } = useLiveMarket();
  // Dev-only state preview; Vite drops this branch from production builds.
  const preview = import.meta.env.DEV ? previewOverrides() : undefined;
  const news = preview?.news ?? liveNews;
  const activity = preview?.activity ?? liveActivity;
  const shock = news.state === 'live' ? news.value : undefined;

  const [pingMessage, setPingMessage] = useState('');
  const [pinging, setPinging] = useState(false);

  const chart = priceChartView({
    samples: priceHistory,
    clientObserved: priceHistoryIsClientObserved,
  });

  async function sendPing() {
    setPinging(true);
    setPingMessage('');
    try {
      await ping();
      setPingMessage('Ping confirmed');
    } catch (cause) {
      setPingMessage(cause instanceof Error ? cause.message : 'Ping failed');
    } finally {
      setPinging(false);
    }
  }

  return (
    <div className={`terminal ${shock ? 'terminal-chaos' : ''}`}>
      <header className="masthead">
        <a className="wordmark" href="/">
          One Market
        </a>
        <p className="masthead-note">
          One market, shared by everyone watching. All money is synthetic.
        </p>
        <span
          className={`link ${status === 'Connected' ? 'link-live' : ''}`}
          data-testid="connection-status"
        >
          {status}
        </span>
      </header>

      {shock && <ChaosBanner news={shock} />}

      <section
        className={`hero hero-${chart.direction}`}
        aria-label="Live market state"
      >
        <div className="hero-plot">{chart.element}</div>

        <div className="hero-face">
          <div className="hero-price">
            <h2>ONE</h2>
            <strong>
              {snapshot ? (
                formatUsd(snapshot.priceCents)
              ) : (
                <span className="awaiting">No price</span>
              )}
            </strong>
            <p>{chart.caption}</p>
          </div>

          <div className="hero-clock">
            <h2>Tick</h2>
            <strong data-testid="tick">
              {snapshot ? (
                formatCount(snapshot.logicalTick)
              ) : (
                <span className="awaiting">No clock</span>
              )}
            </strong>
          </div>
        </div>

        <div className="hero-meter">
          <EpochMeter slot={snapshot?.slot ?? -1} />
          <p>
            {snapshot
              ? `Epoch ${formatCount(snapshot.epoch)} · slot ${snapshot.slot + 1} of ${TICKS_PER_EPOCH}`
              : 'Waiting for the shared clock'}
            <span className="hero-sep" />
            {TARGET_HZ} Hz target
          </p>
        </div>
      </section>

      <section className="channels" aria-label="Population and throughput">
        <Channel
          label="Autonomous actors"
          value={snapshot ? live(formatCount(snapshot.actorCount)) : WAITING}
          note="Persistent policy actors in the world"
        />
        <Channel
          label="Filled orders / sec"
          value={mapPending(
            snapshot?.filledOrdersPerSecond ?? WAITING,
            (rate) => rate.toLocaleString('en-US'),
          )}
        />
        <Channel
          label="Connected identities"
          value={mapPending(
            snapshot?.connectedIdentityCount ?? WAITING,
            formatCount,
          )}
        />
        <Channel
          label="Verified capacity"
          value={mapPending(
            verifiedCapacity,
            (result) =>
              `${formatCount(result.actorCount)} @ ${result.tickHz} Hz`,
          )}
        />
      </section>

      <div className="floor">
        <ActivityTape activity={activity} />
        <TradePanel enabled={false} />
      </div>

      <footer className="footer">
        <p>
          Open this page in a second window. Both read the same tick from the
          same database.
        </p>
        <div className="footer-actions">
          <button
            disabled={status !== 'Connected' || pinging}
            onClick={sendPing}
          >
            {pinging ? 'Sending…' : 'Ping runtime'}
          </button>
          <p className="ping-result" role="status">
            {pingMessage}
          </p>
        </div>
      </footer>

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button onClick={reconnect}>Reconnect</button>
        </div>
      )}
    </div>
  );
}
