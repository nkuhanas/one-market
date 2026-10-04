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
        <h1>
          ONE
          <span className="market-kind">Synthetic market</span>
        </h1>
        <p className="market-line">
          One market. Thousands of autonomous minds.
        </p>
        <p className="market-sub">
          A single persistent world shared by every browser watching it, traded
          by autonomous policy actors and by people. All money is synthetic.
        </p>
      </div>

      <div className="market-price">
        <span className="market-price-label">Last traded</span>
        <strong className={`price tone-${tone || 'neutral'}`}>
          {snapshot ? formatUsd(snapshot.priceCents) : '—'}
        </strong>
        {moveBps !== undefined && moveBps !== 0 && (
          <span className={`market-move tone-${tone}`}>
            {formatSignedPercent(moveBps)} on the last clearing
          </span>
        )}
        {moveBps === 0 && (
          <span className="market-move">Unchanged on the last clearing</span>
        )}
      </div>
    </section>
  );
}
