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
