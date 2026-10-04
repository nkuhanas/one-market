/**
 * The presentation-side view of the client contract in SPEC.md section 12.
 *
 * Chace owns the schema below the generated bindings; this module maps those
 * rows into the shapes the interface renders. Two rules hold throughout:
 * a value is only ever shown as live when a subscription actually supplied it,
 * and a surface the runtime does not populate is `Pending` rather than zero.
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

export function mapPending<T, U>(
  value: Pending<T>,
  format: (value: T) => U,
): Pending<U> {
  return value.state === 'live' ? live(format(value.value)) : value;
}

/** Retention limits and cadence constants, from sections 5 and 12. */
export const PRICE_HISTORY_TICKS = 3600;
export const ACTIVITY_FEED_LIMIT = 500;
export const ACTOR_SAMPLE_LIMIT = 64;
export const TICKS_PER_EPOCH = 20;
export const TARGET_HZ = 20;

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected';
export type OrderSide = 'BUY' | 'SELL';

export interface PriceSample {
  readonly logicalTick: bigint;
  readonly priceCents: bigint;
  readonly matchedShareVolume: bigint;
}

export interface MarketSnapshot {
  readonly logicalTick: bigint;
  readonly epoch: bigint;
  readonly slot: number;
  readonly priceCents: bigint;
  readonly previousTradedPriceCents: bigint;
  readonly matchedShareVolume: bigint;
  readonly volatilityBps: bigint;
  readonly actorCount: bigint;
  readonly activeActorCount: bigint;
  readonly registeredHumanTraderCount: bigint;
  readonly connectedIdentityCount: bigint;
  readonly cumulativeOrdersFilled: bigint;
  readonly cumulativeMatchedShareVolume: bigint;
  readonly rateWindowUs: bigint;
  readonly chaosActive: boolean;
  readonly phase: string;
}

export interface ActivityEntry {
  readonly id: bigint;
  readonly logicalTick: bigint;
  readonly participantType: 'ACTOR' | 'HUMAN';
  readonly participantId: string;
  readonly eventKind: 'FILLED' | 'WIPED';
  readonly side: OrderSide | '';
  readonly quantity: bigint;
  readonly priceCents: bigint;
  readonly lifetimePnlCents: bigint;
  readonly wipeoutCount: bigint;
}

export interface ActorRow {
  readonly actorId: bigint;
  readonly status: 'ACTIVE' | 'EXITING' | 'COOLDOWN';
  readonly markedEquityCents: bigint;
  readonly lifetimePnlCents: bigint;
  readonly wipeoutCount: bigint;
}

export interface NewsShock {
  readonly id: bigint;
  readonly headline: string;
  readonly bearish: boolean;
  readonly severityBps: bigint;
  readonly confidenceBps: bigint;
  readonly startTick: bigint;
  readonly endTick: bigint;
}

export interface CapacityResult {
  readonly actorCount: bigint;
  readonly tickIntervalUs: bigint;
  readonly environment: string;
  readonly workloadProfile: string;
}

export interface Trader {
  readonly cashCents: bigint;
  readonly shares: bigint;
  readonly reservedCashCents: bigint;
  readonly reservedShares: bigint;
  readonly pnlCents: bigint;
  readonly completedOrders: bigint;
}

export interface PendingOrder {
  readonly clientOrderId: bigint;
  readonly buy: boolean;
  readonly quantity: bigint;
  readonly limitPriceCents: bigint;
}

export interface FillReceipt {
  readonly key: string;
  readonly sequence: bigint;
  readonly clientOrderId: bigint;
  readonly logicalTick: bigint;
  readonly buy: boolean;
  readonly requestedQuantity: bigint;
  readonly filledQuantity: bigint;
  readonly priceCents: bigint;
  readonly status: string;
}

/** The runtime publishes these as strings; narrow them without trusting them. */
export function asParticipant(value: string): 'ACTOR' | 'HUMAN' {
  return value === 'HUMAN' ? 'HUMAN' : 'ACTOR';
}

export function asEventKind(value: string): 'FILLED' | 'WIPED' {
  return value === 'WIPED' ? 'WIPED' : 'FILLED';
}

export function asSide(value: string): OrderSide | '' {
  return value === 'BUY' || value === 'SELL' ? value : '';
}

export function asActorStatus(value: string): ActorRow['status'] {
  return value === 'EXITING' || value === 'COOLDOWN' ? value : 'ACTIVE';
}
