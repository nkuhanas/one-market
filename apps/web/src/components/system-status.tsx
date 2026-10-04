import { useState } from 'react';
import { formatCount } from '../lib/units';
import { ChaosControl } from './chaos-control';
import {
  cadenceLabel,
  type Cadence,
  type ConnectionStatus,
  type MarketSnapshot,
} from '../market/contract';

/**
 * Runtime diagnostics, kept deliberately secondary. The epoch meter is the one
 * piece of simulation structure worth showing inline: one bar per tick slot, so
 * the sweep completes once per logical epoch (SPEC.md section 5).
 */
export function SystemStatus({
  snapshot,
  cadence,
  status,
  error,
  pricePoints,
  showChaos,
  onPing,
  onTriggerChaos,
  onReconnect,
}: {
  snapshot?: MarketSnapshot;
  cadence?: Cadence;
  status: ConnectionStatus;
  error: string;
  pricePoints: number;
  showChaos: boolean;
  onPing: () => Promise<void>;
  onTriggerChaos: () => Promise<void>;
  onReconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pingMessage, setPingMessage] = useState('');
  const [pinging, setPinging] = useState(false);
  const buckets = cadence?.bucketCount ?? 0;
  const slot =
    snapshot && buckets > 0
      ? Number(snapshot.logicalTick % BigInt(buckets))
      : -1;

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
        <div className="epoch" aria-hidden="true">
          {Array.from({ length: buckets }, (_, index) => (
            <span
              key={index}
              className={
                index === slot
                  ? 'slot slot-now'
                  : index < slot
                    ? 'slot slot-done'
                    : 'slot'
              }
            />
          ))}
        </div>
        <p className="system-line">
          {snapshot && cadence
            ? `Epoch ${formatCount(snapshot.epoch)}, slot ${slot + 1} of ${buckets}`
            : 'Waiting for the shared clock'}
          <span className="dot" />
          {cadenceLabel(cadence)}
          <span className="dot" />
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
        </div>
      )}

      {showChaos && (
        <ChaosControl
          chaosActive={snapshot?.chaosActive ?? false}
          connected={status === 'Connected'}
          onTrigger={onTriggerChaos}
        />
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
