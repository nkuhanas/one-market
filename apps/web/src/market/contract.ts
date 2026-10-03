/**
 * The frontend's view of the client contract in SPEC.md section 12.
 *
 * Chace owns the schema below the generated bindings; this module is the
 * presentation-side shape it maps onto. Most section 12 surfaces are specified
 * but not yet in the module, so fields the runtime does not publish yet are
 * `Pending` rather than zero. A zero and an unimplemented field read very
 * differently to anyone looking at the screen, and section 14 forbids implying
 * capacity that has not been measured.
 */

export type Pending<T> =
  | { readonly state: 'pending'; readonly reason: string }
  | { readonly state: 'live'; readonly value: T };

export function pending<T>(reason: string): Pending<T> {
  return { state: 'pending', reason };
}

export function live<T>(value: T): Pending<T> {
  return { state: 'live', value };
}

/** Retention limit for price history, from the section 12 table. */
export const PRICE_HISTORY_TICKS = 3600;

/** Retention limits for the public feeds, from the section 12 table. */
export const ACTIVITY_FEED_LIMIT = 500;
export const NEWS_LIMIT = 16;

/** Ticks per logical epoch, from section 5. Twenty buckets, one per slot. */
export const TICKS_PER_EPOCH = 20;

/** Target cadence in hertz, from section 5. */
export const TARGET_HZ = 20;

export interface PriceSample {
  readonly logicalTick: bigint;
  readonly priceCents: bigint;
}

export interface MarketSnapshot {
  /** Live today as `market_state.tick`; becomes `logical_tick`. */
  readonly logicalTick: bigint;
  /** Live today as `market_state.price`; becomes `price_cents`. */
  readonly priceCents: bigint;
  /** Live today, and zero until the actor runtime is deployed. */
  readonly actorCount: bigint;

  readonly epoch: bigint;
  readonly slot: number;

  readonly previousTradedPriceCents: Pending<bigint>;
  readonly matchedShareVolume: Pending<bigint>;
  readonly volatilityBps: Pending<number>;
  readonly activeActorCount: Pending<bigint>;
  readonly registeredHumanTraderCount: Pending<bigint>;
  readonly connectedIdentityCount: Pending<bigint>;
  readonly filledOrdersPerSecond: Pending<number>;
  readonly chaosActive: Pending<boolean>;
}

/**
 * A CHAOS shock (section 10). The shock moves each actor's news signal; it does
 * not move the price directly. Any price change is whatever the auction clears
 * once policies have independently responded, so a frozen market is a valid
 * outcome of a shock.
 */
export type NewsDirection = 'BULLISH' | 'BEARISH';

export interface NewsEvent {
  readonly id: bigint;
  readonly headline: string;
  readonly direction: NewsDirection;
  readonly severityBps: number;
  readonly confidenceBps: number;
  readonly startTick: bigint;
  readonly endTick: bigint;
}

export type ParticipantType = 'ACTOR' | 'HUMAN';
export type OrderSide = 'BUY' | 'SELL';

/**
 * One entry on the public tape. This is sampled presentation data and is rate
 * limited by the runtime, so its length can never be used to compute actual
 * trading throughput (section 12).
 */
export type ActivityEntry = {
  readonly id: bigint;
  readonly logicalTick: bigint;
  readonly participantType: ParticipantType;
  /** Public identifier only. Never an actor's or human's private state. */
  readonly publicId: string;
} & (
  | {
      readonly kind: 'FILLED';
      readonly side: OrderSide;
      readonly quantity: bigint;
      readonly priceCents: bigint;
    }
  | {
      readonly kind: 'WIPED';
      /** Signed, grant-adjusted lifetime P&L in cents. */
      readonly lifetimePnlCents: bigint;
      readonly wipeoutCount: bigint;
    }
);

/** Section 14: the one public headline, sourced only from a qualified result. */
export interface VerifiedCapacity {
  readonly actorCount: bigint;
  readonly tickHz: number;
  readonly environment: 'LOCAL' | 'MAINCLOUD';
  readonly workloadProfile: string;
}

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected';

export interface MarketView {
  readonly snapshot?: MarketSnapshot;
  readonly priceHistory: readonly PriceSample[];
  /** True while history is the client's own observation, not `PricePoint`. */
  readonly priceHistoryIsClientObserved: boolean;
  readonly verifiedCapacity: Pending<VerifiedCapacity>;
  /** The shock in effect right now, if any. */
  readonly news: Pending<NewsEvent | undefined>;
  readonly activity: Pending<readonly ActivityEntry[]>;
  readonly status: ConnectionStatus;
  readonly error: string;
  ping(): Promise<void>;
  reconnect(): void;
}

/** Maps a pending value's payload while preserving its pending reason. */
export function mapPending<T, U>(
  value: Pending<T>,
  format: (value: T) => U,
): Pending<U> {
  return value.state === 'live' ? live(format(value.value)) : value;
}
