import { useState } from 'react';

/**
 * The admin shock control (SPEC.md sections 10 and 13).
 *
 * The runtime authorises `trigger_chaos` against its private admin allowlist,
 * so this is only ever an offer to call it. Anyone who finds it and is not an
 * admin gets the refusal straight from the server.
 *
 * It lives inside the collapsed diagnostics panel because firing the shock
 * calls `fail_run` and invalidates the benchmark in progress.
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
      setMessage('Shock released. Watch the agents respond.');
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
      <button
        type="button"
        className="danger"
        disabled={!connected || busy || chaosActive}
        onClick={fire}
        title="Releases a news shock into every agent's signal and fails the benchmark run in progress"
      >
        {chaosActive ? 'Already going' : busy ? 'Releasing…' : "Don't click"}
      </button>
      <p className="chaos-control-note" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </div>
  );
}
