import { useState } from 'react';

/**
 * The admin shock control (SPEC.md sections 10 and 13).
 *
 * `trigger_chaos` is authorised against the private admin allowlist by the
 * runtime, so this is only ever an offer to call it: the `?admin` flag decides
 * whether the control is shown, never whether it is permitted. A visitor who
 * finds the flag still gets "admin authorization required" from the server.
 *
 * It is kept off the default view because firing it deliberately fails the
 * active benchmark run, which is not something a passer-by should do by
 * accident.
 */
export function ChaosControl({
  chaosActive,
  connected,
  onTrigger,
}: {
  chaosActive: boolean;
  connected: boolean;
  onTrigger: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function fire() {
    setBusy(true);
    setMessage('');
    try {
      await onTrigger();
      setMessage('Shock released. Watch the actors respond.');
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'The runtime refused the shock.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chaos-control">
      <div>
        <h3>Chaos</h3>
        <p>
          Releases a fixed news shock into every actor&apos;s signal. It does
          not move the price directly, and it fails the active benchmark run.
        </p>
      </div>
      <div className="chaos-control-actions">
        <button
          type="button"
          className="danger"
          disabled={!connected || busy || chaosActive}
          onClick={fire}
        >
          {chaosActive
            ? 'Shock in effect'
            : busy
              ? 'Releasing…'
              : 'Trigger chaos'}
        </button>
        <p className="chaos-control-note" aria-live="polite" aria-atomic="true">
          {message}
        </p>
      </div>
    </div>
  );
}
