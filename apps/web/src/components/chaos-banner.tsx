import { formatSignedPercent } from '../lib/units';
import type { NewsEvent } from '../market/contract';

/**
 * The shock in effect, from SPEC.md section 10. The headline states what the
 * actors were told, not what the price will do: severity and confidence are
 * inputs to each policy's news signal, and the market may clear in either
 * direction or not at all.
 */
export function ChaosBanner({ news }: { news: NewsEvent }) {
  const falling = news.direction === 'BEARISH';
  return (
    <aside className={`chaos ${falling ? 'chaos-bearish' : 'chaos-bullish'}`}>
      <p className="chaos-tag">Chaos in effect</p>
      <p className="chaos-headline">{news.headline}</p>
      <p className="chaos-meta">
        Signal{' '}
        {formatSignedPercent(falling ? -news.severityBps : news.severityBps)} at{' '}
        {(news.confidenceBps / 100).toFixed(0)}% confidence. Every actor decides
        for itself what to do with it.
      </p>
    </aside>
  );
}
