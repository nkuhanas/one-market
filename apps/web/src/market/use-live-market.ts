import { useCallback, useEffect, useRef, useState } from 'react';
import { DbConnection } from '@one-market/bindings';
import { openOrderedWebSocket } from '@one-market/transport';
import type { MarketState } from '@one-market/bindings/types';
import {
  PRICE_HISTORY_TICKS,
  TICKS_PER_EPOCH,
  pending,
  type ConnectionStatus,
  type MarketSnapshot,
  type MarketView,
  type PriceSample,
} from './contract';

const NO_RUNTIME = 'Awaiting the market runtime';
const NO_BENCHMARK = 'Awaiting a qualified benchmark result';

const EPOCH_TICKS = BigInt(TICKS_PER_EPOCH);

function toSnapshot(row: MarketState): MarketSnapshot {
  return {
    logicalTick: row.tick,
    priceCents: row.price,
    actorCount: row.actorCount,
    epoch: row.tick / EPOCH_TICKS,
    slot: Number(row.tick % EPOCH_TICKS),
    previousTradedPriceCents: pending(NO_RUNTIME),
    matchedShareVolume: pending(NO_RUNTIME),
    volatilityBps: pending(NO_RUNTIME),
    activeActorCount: pending(NO_RUNTIME),
    registeredHumanTraderCount: pending(NO_RUNTIME),
    connectedIdentityCount: pending(NO_RUNTIME),
    filledOrdersPerSecond: pending(NO_RUNTIME),
    chaosActive: pending(NO_RUNTIME),
  };
}

/**
 * Subscribes to the authoritative market state and keeps the connection
 * lifecycle honest: every value shown upstream of this hook arrives over a
 * SpacetimeDB subscription. Nothing here simulates, interpolates, or animates
 * state the runtime did not send.
 */
export function useLiveMarket(): MarketView {
  const [snapshot, setSnapshot] = useState<MarketSnapshot>();
  const [priceHistory, setPriceHistory] = useState<readonly PriceSample[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('Connecting');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const connection = useRef<DbConnection | null>(null);

  useEffect(() => {
    let disposed = false;
    setStatus('Connecting');
    setError('');
    setSnapshot(undefined);
    setPriceHistory([]);

    const record = (row: MarketState) => {
      setSnapshot(toSnapshot(row));
      setPriceHistory((history) => {
        const last = history[history.length - 1];
        if (last && last.logicalTick === row.tick) return history;
        const next = [
          ...history,
          { logicalTick: row.tick, priceCents: row.price },
        ];
        return next.length > PRICE_HISTORY_TICKS
          ? next.slice(next.length - PRICE_HISTORY_TICKS)
          : next;
      });
    };

    const conn = DbConnection.builder()
      .withWSFn(openOrderedWebSocket)
      .withCompression('gzip')
      .withConfirmedReads(true)
      .withUri(import.meta.env.VITE_SPACETIMEDB_HOST || 'http://localhost:3000')
      .withDatabaseName(
        import.meta.env.VITE_SPACETIMEDB_DATABASE || 'one-market-local',
      )
      .onConnect((connected) => {
        if (disposed) return;
        connected
          .subscriptionBuilder()
          .onApplied(() => {
            if (disposed) return;
            const row = connected.db.marketState.id.find(0);
            if (!row) {
              setStatus('Disconnected');
              setError('Market state is unavailable. Republish the module.');
              return;
            }
            record(row);
            setStatus('Connected');
          })
          .onError((ctx) => {
            if (disposed) return;
            setStatus('Disconnected');
            setError(ctx.event?.message || 'Market subscription failed.');
          })
          .subscribe(['SELECT * FROM market_state']);
      })
      .onConnectError((_ctx, cause) => {
        if (disposed) return;
        setStatus('Disconnected');
        setError(cause.message);
      })
      .onDisconnect((_ctx, cause) => {
        if (disposed) return;
        setStatus('Disconnected');
        setError(
          cause?.message ||
            'Connection closed. Reconnect to resume live updates.',
        );
      })
      .build();
    connection.current = conn;

    const onUpdate = (_ctx: unknown, _old: MarketState, next: MarketState) => {
      if (!disposed) record(next);
    };
    conn.db.marketState.onUpdate(onUpdate);

    return () => {
      disposed = true;
      conn.db.marketState.removeOnUpdate(onUpdate);
      conn.disconnect();
      connection.current = null;
    };
  }, [attempt]);

  const ping = useCallback(async () => {
    if (!connection.current?.isActive)
      throw new Error('Connect to the market first.');
    await connection.current.reducers.ping({});
  }, []);

  const reconnect = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    snapshot,
    priceHistory,
    // The module has no PricePoint table yet, so history is only what this
    // browser has watched since it connected.
    priceHistoryIsClientObserved: true,
    verifiedCapacity: pending(NO_BENCHMARK),
    news: pending(NO_RUNTIME),
    activity: pending(NO_RUNTIME),
    status,
    error,
    ping,
    reconnect,
  };
}
