import { useState } from 'react';
import { formatShares, formatUsd } from '../lib/units';
import type {
  MarketSnapshot,
  OrderSide,
  Pending,
  PendingOrder,
  Trader,
} from '../market/contract';

const SLIPPAGE_CHOICES = [50n, 100n, 250n];

/**
 * Human order entry (SPEC.md sections 8 and 13).
 *
 * The reducer takes a limit price, but the control asks for a slippage
 * allowance and derives one, so taking part never requires understanding limit
 * orders. Browser validation is convenience only: the runtime enforces
 * balances, order size, rate limits and one outstanding order per identity.
 */
export function OrderPanel({
  snapshot,
  trader,
  pendingOrder,
  connected,
  onEnter,
  onPlace,
}: {
  snapshot?: MarketSnapshot;
  trader: Pending<Trader>;
  pendingOrder?: PendingOrder;
  connected: boolean;
  onEnter: () => Promise<void>;
  onPlace: (args: {
    side: OrderSide;
    quantity: bigint;
    limitPriceCents: bigint;
  }) => Promise<void>;
}) {
  const [side, setSide] = useState<OrderSide>('BUY');
  const [quantity, setQuantity] = useState('25');
  const [slippageBps, setSlippageBps] = useState(100n);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const joined = trader.state === 'live';
  const shares = BigInt(quantity || '0');
  const price = snapshot?.priceCents ?? 0n;
  // Buying accepts a higher price, selling accepts a lower one.
  const limitPriceCents =
    side === 'BUY'
      ? (price * (10_000n + slippageBps)) / 10_000n
      : (price * (10_000n - slippageBps)) / 10_000n;
  const estimate = shares * limitPriceCents;

  const blocked =
    !connected || busy || shares <= 0n || price === 0n || Boolean(pendingOrder);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'The market refused that order.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="order" aria-label="Place an order">
      <div className="order-head">
        <h2>Your order</h2>
        {joined ? (
          <span className="order-balance mono">
            {formatUsd(trader.value.cashCents, 'cash_cents')} ·{' '}
            {formatShares(trader.value.shares)} sh
          </span>
        ) : (
          <span className="order-balance">Not trading yet</span>
        )}
      </div>

      {!joined ? (
        <div className="order-join">
          <p>
            Enter with a synthetic bankroll and trade in the same auction as the
            autonomous actors.
          </p>
          <button
            type="button"
            className="primary"
            disabled={!connected || busy}
            onClick={() => run(onEnter, 'You are in the market.')}
          >
            {busy ? 'Entering…' : 'Enter the market'}
          </button>
        </div>
      ) : (
        <>
          <div className="sides" role="group" aria-label="Side">
            {(['BUY', 'SELL'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`side side-${option.toLowerCase()} ${side === option ? 'side-on' : ''}`}
                aria-pressed={side === option}
                onClick={() => setSide(option)}
              >
                {option === 'BUY' ? 'Buy' : 'Sell'}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Shares</span>
            <input
              inputMode="numeric"
              value={quantity}
              onChange={(e) =>
                setQuantity(e.target.value.replace(/[^0-9]/g, ''))
              }
            />
          </label>

          <fieldset className="field">
            <legend>Accept up to</legend>
            <div className="chips">
              {SLIPPAGE_CHOICES.map((bps) => (
                <button
                  key={String(bps)}
                  type="button"
                  className={`chip ${slippageBps === bps ? 'chip-on' : ''}`}
                  aria-pressed={slippageBps === bps}
                  onClick={() => setSlippageBps(bps)}
                >
                  {(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 1)}
                  %
                </button>
              ))}
            </div>
          </fieldset>

          <dl className="summary">
            <div>
              <dt>Limit price</dt>
              <dd className="mono">{formatUsd(limitPriceCents)}</dd>
            </div>
            <div>
              <dt>{side === 'BUY' ? 'Reserves' : 'Proceeds up to'}</dt>
              <dd className="mono">{formatUsd(estimate)}</dd>
            </div>
          </dl>

          <button
            type="button"
            className={`primary place place-${side.toLowerCase()}`}
            disabled={blocked}
            onClick={() =>
              run(
                () => onPlace({ side, quantity: shares, limitPriceCents }),
                'Order accepted into the next auction.',
              )
            }
          >
            {busy
              ? 'Submitting…'
              : `Place ${side === 'BUY' ? 'buy' : 'sell'} order`}
          </button>

          {pendingOrder && (
            <p className="order-pending">
              {pendingOrder.buy ? 'Buy' : 'Sell'}{' '}
              {formatShares(pendingOrder.quantity)} at{' '}
              {formatUsd(pendingOrder.limitPriceCents)} is waiting for the next
              clearing. One order at a time.
            </p>
          )}
        </>
      )}

      {message && <p className="order-message">{message}</p>}
      <p className="order-note">
        Orders join the next tick&apos;s auction and clear at one price. An
        accepted order is not a guaranteed fill.
      </p>
    </aside>
  );
}
