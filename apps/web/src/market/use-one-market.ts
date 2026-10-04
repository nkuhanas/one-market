import { useCallback, useEffect, useRef, useState } from 'react';
import { DbConnection } from '@one-market/bindings';
import { openOrderedWebSocket } from '@one-market/transport';
import type {
  ActorSample,
  HumanOrderReceipt,
  HumanTrader,
  MarketState,
  NewsEvent,
  PendingHumanOrder,
  PricePoint,
  PublicActivity,
} from '@one-market/bindings/types';
import {
  ACTIVITY_FEED_LIMIT,
  ACTOR_SAMPLE_LIMIT,
  asActorStatus,
  asEventKind,
  asParticipant,
  asSide,
  live,
  pending,
  PRICE_HISTORY_TICKS,
  selectCapacity,
  type Cadence,
  type ActivityEntry,
  type ActorRow,
  type CapacityResult,
  type ConnectionStatus,
  type FillReceipt,
  type MarketSnapshot,
  type NewsShock,
  type Pending,
  type PendingOrder,
  type PriceSample,
  type Trader,
} from './contract';

const NO_RUN = 'No qualified run yet';
const NOT_JOINED = 'Not trading yet';

/**
 * Feeds other than the clock are flushed on an interval rather than on every
 * row. Repainting a 3,600-point chart or a
 * 500-row tape that often costs far more than it communicates.
 */
const FEED_FLUSH_MS = 250;

/** How many lifecycle events this browser keeps after watching them arrive. */
const LIFECYCLE_RETAINED = 60;

function toSnapshot(row: MarketState): MarketSnapshot {
  return {
    logicalTick: row.logicalTick,
    epoch: row.epoch,
    priceCents: row.priceCents,
    previousTradedPriceCents: row.previousTradedPriceCents,
    matchedShareVolume: row.matchedShareVolume,
    volatilityBps: row.volatilityBps,
    actorCount: row.actorCount,
    activeActorCount: row.activeActorCount,
    registeredHumanTraderCount: row.registeredHumanTraderCount,
    connectedIdentityCount: row.connectedIdentityCount,
    cumulativeActorSteps: row.cumulativeActorSteps,
    cumulativePolicyEvaluations: row.cumulativePolicyEvaluations,
    cumulativeOrdersSubmitted: row.cumulativeOrdersSubmitted,
    cumulativeOrdersFilled: row.cumulativeOrdersFilled,
    cumulativeMatchedShareVolume: row.cumulativeMatchedShareVolume,
    rateWindowUs: row.rateWindowUs,
    chaosActive: row.chaosActive,
    phase: row.phase,
  };
}

const toSample = (row: PricePoint): PriceSample => ({
  logicalTick: row.logicalTick,
  recordedAtUs: row.recordedAt.microsSinceUnixEpoch,
  priceCents: row.priceCents,
  matchedShareVolume: row.matchedShareVolume,
});

const toActivity = (row: PublicActivity): ActivityEntry => ({
  id: row.id,
  logicalTick: row.logicalTick,
  participantType: asParticipant(row.participantType),
  participantId: row.participantId,
  eventKind: asEventKind(row.eventKind),
  side: asSide(row.side),
  quantity: row.quantity,
  priceCents: row.priceCents,
  lifetimePnlCents: row.lifetimePnlCents,
  wipeoutCount: row.wipeoutCount,
});

const toActor = (row: ActorSample): ActorRow => ({
  actorId: row.actorId,
  status: asActorStatus(row.status),
  markedEquityCents: row.markedEquityCents,
  lifetimePnlCents: row.lifetimePnlCents,
  wipeoutCount: row.wipeoutCount,
});

const toShock = (row: NewsEvent): NewsShock => ({
  id: row.id,
  headline: row.headline,
  bearish: row.direction < 0,
  severityBps: row.severityBps,
  confidenceBps: row.confidenceBps,
  startTick: row.startTick,
  endTick: row.endTick,
});

const toTrader = (row: HumanTrader): Trader => ({
  cashCents: row.cashCents,
  shares: row.shares,
  reservedCashCents: row.reservedCashCents,
  reservedShares: row.reservedShares,
  pnlCents: row.pnlCents,
  completedOrders: row.completedOrders,
});

const toPendingOrder = (row: PendingHumanOrder): PendingOrder => ({
  clientOrderId: row.clientOrderId,
  buy: row.buy,
  quantity: row.quantity,
  limitPriceCents: row.limitPriceCents,
});

const toReceipt = (row: HumanOrderReceipt): FillReceipt => ({
  key: row.key,
  sequence: row.sequence,
  clientOrderId: row.clientOrderId,
  logicalTick: row.logicalTick,
  buy: row.buy,
  requestedQuantity: row.requestedQuantity,
  filledQuantity: row.filledQuantity,
  priceCents: row.priceCents,
  status: row.status,
});

export interface OneMarket {
  readonly cadence?: Cadence;
  readonly snapshot?: MarketSnapshot;
  readonly priceHistory: readonly PriceSample[];
  readonly activity: readonly ActivityEntry[];
  /** Lifecycle events observed by this browser since it connected. */
  readonly kills: readonly ActivityEntry[];
  readonly actors: readonly ActorRow[];
  readonly shock?: NewsShock;
  readonly capacity: Pending<CapacityResult>;
  readonly trader: Pending<Trader>;
  readonly pendingOrder?: PendingOrder;
  readonly fills: readonly FillReceipt[];
  readonly status: ConnectionStatus;
  readonly error: string;
  ping(): Promise<void>;
  enterMarket(): Promise<void>;
  placeOrder(args: {
    side: 'BUY' | 'SELL';
    quantity: bigint;
    limitPriceCents: bigint;
  }): Promise<void>;
  triggerChaos(): Promise<void>;
  reconnect(): void;
}

export function useOneMarket(): OneMarket {
  const [cadence, setCadence] = useState<Cadence>();
  const [snapshot, setSnapshot] = useState<MarketSnapshot>();
  const [priceHistory, setPriceHistory] = useState<readonly PriceSample[]>([]);
  const [activity, setActivity] = useState<readonly ActivityEntry[]>([]);
  const [kills, setKills] = useState<readonly ActivityEntry[]>([]);
  const [actors, setActors] = useState<readonly ActorRow[]>([]);
  const [shock, setShock] = useState<NewsShock>();
  const [capacity, setCapacity] = useState<Pending<CapacityResult>>(
    pending(NO_RUN),
  );
  const [trader, setTrader] = useState<Pending<Trader>>(pending(NOT_JOINED));
  const [pendingOrder, setPendingOrder] = useState<PendingOrder>();
  const [fills, setFills] = useState<readonly FillReceipt[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('Connecting');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const connection = useRef<DbConnection | null>(null);
  // Mirrors the current tick for the feed flush, which needs it to decide which
  // news shock is in effect without re-subscribing on every tick.
  const snapshotTick = useRef(0n);
  snapshotTick.current = snapshot?.logicalTick ?? 0n;

  useEffect(() => {
    let disposed = false;
    setStatus('Connecting');
    setError('');
    setSnapshot(undefined);
    setCadence(undefined);
    setCapacity(pending(NO_RUN));
    setPriceHistory([]);
    setActivity([]);
    setKills([]);
    setActors([]);
    setShock(undefined);

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
            setSnapshot(toSnapshot(row));
            setStatus('Connected');
            flush(connected);
          })
          .onError((ctx) => {
            if (disposed) return;
            setStatus('Disconnected');
            setError(ctx.event?.message || 'Market subscription failed.');
          })
          .subscribe([
            'SELECT * FROM market_state',
            'SELECT * FROM cadence_state',
            'SELECT * FROM price_point',
            'SELECT * FROM public_activity',
            'SELECT * FROM news_event',
            'SELECT * FROM actor_sample',
            'SELECT * FROM benchmark_result',
            'SELECT * FROM my_trader',
            'SELECT * FROM my_pending_order',
            'SELECT * FROM my_recent_fills',
          ]);
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

    // The clock drives the one value that must not lag: everything else is read
    // from the cache on a timer below.
    const onMarket = (_ctx: unknown, _old: MarketState, next: MarketState) => {
      if (!disposed) setSnapshot(toSnapshot(next));
    };
    conn.db.marketState.onUpdate(onMarket);

    // Lifecycle events are caught as they arrive rather than read back from the
    // shared feed. That feed is capped at 500 entries and fills arrive in the
    // hundreds per second, so a wipeout is flushed out of it within seconds and
    // would almost never be visible to a reader that only polls.
    const onActivity = (_ctx: unknown, row: PublicActivity) => {
      if (disposed) return;
      const entry = toActivity(row);
      if (entry.eventKind === 'FILLED') return;
      setKills((current) => [entry, ...current].slice(0, LIFECYCLE_RETAINED));
    };
    conn.db.publicActivity.onInsert(onActivity);

    function flush(db: DbConnection) {
      if (disposed) return;
      const points = [...db.db.pricePoint.iter()]
        .map(toSample)
        .sort((a, b) => (a.logicalTick < b.logicalTick ? -1 : 1));
      setPriceHistory(
        points.length > PRICE_HISTORY_TICKS
          ? points.slice(points.length - PRICE_HISTORY_TICKS)
          : points,
      );
      setActivity(
        [...db.db.publicActivity.iter()]
          .map(toActivity)
          .sort((a, b) => (a.id > b.id ? -1 : 1))
          .slice(0, ACTIVITY_FEED_LIMIT),
      );
      setActors(
        [...db.db.actorSample.iter()]
          .map(toActor)
          .sort((a, b) => (a.actorId < b.actorId ? -1 : 1))
          .slice(0, ACTOR_SAMPLE_LIMIT),
      );
      const current = snapshotTick.current;
      const shocks = [...db.db.newsEvent.iter()].map(toShock);
      setShock(
        shocks.find((n) => current >= n.startTick && current <= n.endTick),
      );
      const timing = db.db.cadenceState.id.find(0);
      const selected =
        timing &&
        timing.tickIntervalUs > 0n &&
        timing.tickIntervalUs <= 1_000_000n &&
        timing.bucketCount > 0
          ? {
              profile: timing.profile,
              tickIntervalUs: timing.tickIntervalUs,
              bucketCount: timing.bucketCount,
            }
          : undefined;
      setCadence(selected);
      setCapacity(selectCapacity([...db.db.benchmarkResult.iter()], selected));
      const mine = [...db.db.myTrader.iter()][0];
      setTrader(mine ? live(toTrader(mine)) : pending(NOT_JOINED));
      const order = [...db.db.myPendingOrder.iter()][0];
      setPendingOrder(order ? toPendingOrder(order) : undefined);
      setFills(
        [...db.db.myRecentFills.iter()]
          .map(toReceipt)
          .sort((a, b) => (a.sequence > b.sequence ? -1 : 1)),
      );
    }

    const timer = setInterval(() => flush(conn), FEED_FLUSH_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
      conn.db.marketState.removeOnUpdate(onMarket);
      conn.db.publicActivity.removeOnInsert(onActivity);
      conn.disconnect();
      connection.current = null;
    };
  }, [attempt]);

  const ping = useCallback(async () => {
    if (!connection.current?.isActive)
      throw new Error('Connect to the market first.');
    await connection.current.reducers.ping({});
  }, []);

  const enterMarket = useCallback(async () => {
    if (!connection.current?.isActive)
      throw new Error('Connect to the market first.');
    await connection.current.reducers.enterMarket({});
  }, []);

  const placeOrder = useCallback(
    async (args: {
      side: 'BUY' | 'SELL';
      quantity: bigint;
      limitPriceCents: bigint;
    }) => {
      if (!connection.current?.isActive)
        throw new Error('Connect to the market first.');
      await connection.current.reducers.placeOrder({
        // Section 8 requires the ID to be stable per order so a retry cannot
        // reserve balances twice.
        clientOrderId: BigInt(Date.now()),
        side: args.side,
        quantity: args.quantity,
        limitPriceCents: args.limitPriceCents,
      });
    },
    [],
  );

  const triggerChaos = useCallback(async () => {
    if (!connection.current?.isActive)
      throw new Error('Connect to the market first.');
    await connection.current.reducers.triggerChaos({});
  }, []);

  const reconnect = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    cadence,
    snapshot,
    priceHistory,
    activity,
    kills,
    actors,
    shock,
    capacity,
    trader,
    pendingOrder,
    fills,
    status,
    error,
    ping,
    enterMarket,
    placeOrder,
    triggerChaos,
    reconnect,
  };
}
