import { useState } from 'react';
import { useMarket } from './use-market';

export function App() {
  const { state, status, error, ping, reconnect } = useMarket();
  const [pingMessage, setPingMessage] = useState('');
  const [pinging, setPinging] = useState(false);

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
    <main>
      <header>
        <a className="wordmark" href="/">
          ONE MARKET<span>●</span>
        </a>
        <span
          className={`connection ${status === 'Connected' ? 'live' : ''}`}
          data-testid="connection-status"
        >
          <span className="indicator" />
          {status}
        </span>
      </header>
      <section className="intro">
        <p className="eyebrow">ONE WORLD. ONE SHARED STATE.</p>
        <h1>
          The market starts
          <br />
          with a heartbeat.
        </h1>
        <p className="description">
          A shared synthetic market for humans and autonomous actors. The clock
          is live. The simulation comes next.
        </p>
      </section>
      <section className="metrics" aria-label="Live market state">
        <article className="metric primary">
          <p>SIMULATION TICK</p>
          <strong data-testid="tick">
            {state?.tick.toLocaleString() ?? '—'}
          </strong>
          <span>Target cadence · 20 Hz</span>
        </article>
        <article className="metric">
          <p>ONE / STARTING PRICE</p>
          <strong>
            {state ? `$${(Number(state.price) / 100).toFixed(2)}` : '—'}
          </strong>
          <span>Static until trading is implemented</span>
        </article>
        <article className="metric">
          <p>AUTONOMOUS ACTORS</p>
          <strong>{state?.actorCount.toLocaleString() ?? '—'}</strong>
          <span>Actor runtime coming next</span>
        </article>
      </section>
      <section className="integration">
        <div>
          <p className="eyebrow">FIRST CONNECTION</p>
          <h2>Every window, the same clock.</h2>
          <p>
            Open another browser window to see the shared tick advance. Ping the
            runtime to check the connection.
          </p>
        </div>
        <div className="actions">
          <button
            disabled={status !== 'Connected' || pinging}
            onClick={sendPing}
          >
            {pinging ? 'Sending…' : 'Ping runtime'}
            <span aria-hidden="true">↗</span>
          </button>
          <p className="ping-result" role="status">
            {pingMessage}
          </p>
        </div>
      </section>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button onClick={reconnect}>Reconnect</button>
        </div>
      )}
      <footer>
        <span>ONE MARKET / LOCAL SCAFFOLD</span>
        <span>All money is synthetic.</span>
      </footer>
    </main>
  );
}
