import { useState } from 'react';
import type { OrderSide } from '../market/contract';

/**
 * Human order entry (SPEC.md sections 8 and 13). The public call is
 * `place_order(client_order_id, side, quantity, limit_price_cents)`, but the
 * controls stay simple: a slippage allowance becomes the limit price, so a
 * visitor never has to understand limit orders to take part.
 *
 * The runtime does not expose `enter_market()` or `place_order()` yet, so the
 * panel states that plainly instead of pretending to accept an order. Browser
 * controls are never authorization: the server validates balances, order size
 * and rate limits regardless of what this form allows.
 */
const SLIPPAGE_CHOICES = [50, 100, 250] as const;

export function TradePanel({ enabled }: { enabled: boolean }) {
  const [side, setSide] = useState<OrderSide>('BUY');
  const [quantity, setQuantity] = useState('100');
  const [slippageBps, setSlippageBps] = useState<number>(100);

  return (
    <section className="trade" aria-label="Place an order">
      <div className="trade-head">
        <h2>Your order</h2>
        {!enabled && (
          <p className="trade-locked">Opens when the market runtime ships</p>
        )}
      </div>

      <div className="trade-sides" role="group" aria-label="Side">
        {(['BUY', 'SELL'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`trade-side ${side === option ? 'trade-side-on' : ''} trade-side-${option.toLowerCase()}`}
            aria-pressed={side === option}
            disabled={!enabled}
            onClick={() => setSide(option)}
          >
            {option === 'BUY' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      <label className="trade-field">
        <span>Shares</span>
        <input
          inputMode="numeric"
          value={quantity}
          disabled={!enabled}
          onChange={(event) =>
            setQuantity(event.target.value.replace(/[^0-9]/g, ''))
          }
        />
      </label>

      <fieldset className="trade-field trade-slippage" disabled={!enabled}>
        <legend>Accept up to</legend>
        <div>
          {SLIPPAGE_CHOICES.map((bps) => (
            <button
              key={bps}
              type="button"
              className={slippageBps === bps ? 'chip chip-on' : 'chip'}
              aria-pressed={slippageBps === bps}
              onClick={() => setSlippageBps(bps)}
            >
              {(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%
            </button>
          ))}
        </div>
      </fieldset>

      <button type="button" className="trade-submit" disabled={!enabled}>
        Place order
      </button>
      <p className="trade-note">
        Orders join the next tick&apos;s auction. An accepted order is not a
        guaranteed fill.
      </p>
    </section>
  );
}
