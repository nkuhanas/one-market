import { changeBps, formatSignedPercent, formatUsd } from '../lib/units';
import type { MarketSnapshot } from '../market/contract';

export function MarketHeader({ snapshot }: { snapshot?: MarketSnapshot }) {
  const moveBps =
    snapshot && snapshot.previousTradedPriceCents > 0n
      ? changeBps(snapshot.priceCents, snapshot.previousTradedPriceCents)
      : undefined;
  const tone =
    moveBps === undefined || moveBps === 0 ? '' : moveBps > 0 ? 'up' : 'down';

  return (
    <section className="market-header" id="market">
      <div className="market-identity">
        {/* The hero owns the page heading; this is the section header for
            the terminal below it. */}
        <h2>
          ONE
          <span className="market-kind">Synthetic market</span>
        </h2>
        <p className="market-sub">All money is synthetic.</p>
      </div>

      <div className="market-price">
        <span className="market-price-label">Last traded</span>
        <strong className={`price tone-${tone || 'neutral'}`}>
          {snapshot ? formatUsd(snapshot.priceCents) : '—'}
        </strong>
        {moveBps !== undefined && moveBps !== 0 && (
          <span className={`market-move chip-move tone-${tone}`}>
            {formatSignedPercent(moveBps)}
          </span>
        )}
        {moveBps === 0 && (
          <span className="market-move">Unchanged on the last clearing</span>
        )}
        {moveBps !== undefined && moveBps !== 0 && (
          <span className="market-move">on the last clearing</span>
        )}
      </div>
    </section>
  );
}
