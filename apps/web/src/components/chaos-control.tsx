import { useState } from 'react';

/**
 * Public shock control. The server coalesces clicks during an active shock;
 * no administrator permission or trader registration is required.
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
      setMessage('Shock released. Agents react when the simulation ticks.');
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
