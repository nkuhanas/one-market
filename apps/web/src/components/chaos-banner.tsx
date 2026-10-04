import type { NewsShock } from '../market/contract';

/**
 * The shock in effect (SPEC.md section 10). The headline states what the agents
 * were told, not what the price will do: severity and confidence feed each
 * policy's news signal, and the auction may clear in either direction or not at
 * all.
 */
export function ChaosBanner({ shock }: { shock: NewsShock }) {
  return (
    <aside className={`chaos ${shock.bearish ? 'chaos-down' : 'chaos-up'}`}>
      <span className="chaos-tag">Chaos in effect</span>
      <p className="chaos-headline">{shock.headline}</p>
      <p className="chaos-meta">
        Signal {shock.bearish ? '−' : '+'}
        {(Number(shock.severityBps) / 100).toFixed(1)}% at{' '}
        {(Number(shock.confidenceBps) / 100).toFixed(0)}% confidence. Every
        agent decides for itself what to do with it.
      </p>
    </aside>
  );
}
