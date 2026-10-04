import { useState } from 'react';
import { formatCount } from '../lib/units';
import { ChaosControl } from './chaos-control';
import type { ConnectionStatus, MarketSnapshot } from '../market/contract';

/**
 * Secondary runtime diagnostics. The simulation clock lives with price history.
 */
export function SystemStatus({
  snapshot,
  status,
  error,
  pricePoints,
  onPing,
  onTriggerChaos,
  onReconnect,
}: {
  snapshot?: MarketSnapshot;
  status: ConnectionStatus;
  error: string;
  pricePoints: number;
  onPing: () => Promise<void>;
  onTriggerChaos: () => Promise<void>;
  onReconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pingMessage, setPingMessage] = useState('');
  const [pinging, setPinging] = useState(false);

  async function sendPing() {
    setPinging(true);
    setPingMessage('');
    try {
      await onPing();
      setPingMessage('Ping confirmed');
    } catch (cause) {
      setPingMessage(cause instanceof Error ? cause.message : 'Ping failed');
    } finally {
      setPinging(false);
    }
  }

  return (
    <section className="system" id="system">
      <div className="system-bar">
        <p className="system-line">
          Runtime diagnostics
          <span className="dot" aria-hidden="true" />
          {snapshot?.phase ?? '—'}
        </p>
        <div className="system-actions">
          <button
            type="button"
            className="ghost"
            disabled={status !== 'Connected' || pinging}
            onClick={sendPing}
          >
            {pinging ? 'Sending…' : 'Ping runtime'}
          </button>
          <p className="ping-result" role="status">
            {pingMessage}
          </p>
          <button
            type="button"
            className="ghost"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide details' : 'Details'}
          </button>
        </div>
      </div>

      {open && (
        <div className="system-detail">
          <dl>
            <div>
              <dt>Connection</dt>
              <dd>{status}</dd>
            </div>
            <div>
              <dt>Price points cached</dt>
              <dd className="mono">{pricePoints}</dd>
            </div>
            <div>
              <dt>Matched volume</dt>
              <dd className="mono">
                {snapshot
                  ? formatCount(snapshot.cumulativeMatchedShareVolume)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Orders filled</dt>
              <dd className="mono">
                {snapshot ? formatCount(snapshot.cumulativeOrdersFilled) : '—'}
              </dd>
            </div>
          </dl>
          <ChaosControl
            chaosActive={snapshot?.chaosActive ?? false}
            connected={status === 'Connected'}
            onTrigger={onTriggerChaos}
          />
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onReconnect}>
            Reconnect
          </button>
        </div>
      )}
    </section>
  );
}
