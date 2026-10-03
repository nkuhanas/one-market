import { useCallback, useEffect, useRef, useState } from 'react';
import { DbConnection } from '@one-market/bindings';
import type { MarketState } from '@one-market/bindings/types';

export function useMarket() {
  const [state, setState] = useState<MarketState>();
  const [status, setStatus] = useState('Connecting');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const connection = useRef<DbConnection | null>(null);

  useEffect(() => {
    let disposed = false;
    setStatus('Connecting');
    setError('');
    setState(undefined);
    const conn = DbConnection.builder()
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
            setState(row);
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
      if (!disposed) setState(next);
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
  return { state, status, error, ping, reconnect };
}
