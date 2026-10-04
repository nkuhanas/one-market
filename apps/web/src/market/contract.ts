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

/** Retention limits, from section 12. Clock metadata comes from the server. */
export const PRICE_HISTORY_TICKS = 3600;
export const ACTIVITY_FEED_LIMIT = 500;
export const ACTOR_SAMPLE_LIMIT = 64;

export interface Cadence {
  readonly profile: string;
  readonly tickIntervalUs: bigint;
  readonly bucketCount: number;
}

export function cadenceLabel(cadence?: Cadence): string {
  return cadence
    ? `${1_000_000 / Number(cadence.tickIntervalUs)} Hz target`
    : 'Cadence pending';
}

/** Zero-based position in the server's epoch, without narrowing a u64 tick. */
export function epochSlot(
  logicalTick?: bigint,
  bucketCount?: number,
): number | undefined {
  if (
    logicalTick === undefined ||
    bucketCount === undefined ||
    !Number.isSafeInteger(bucketCount) ||
    bucketCount <= 0
  )
    return undefined;
  return Number(logicalTick % BigInt(bucketCount));
}

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected';
export type OrderSide = 'BUY' | 'SELL';

export interface PriceSample {
  readonly logicalTick: bigint;
  readonly recordedAtUs: bigint;
  readonly priceCents: bigint;
  readonly matchedShareVolume: bigint;
}

/** Use server timestamps, not tick counts, across cadence changes and pauses. */
export function priceWindow(
  samples: readonly PriceSample[],
  seconds: number,
): readonly PriceSample[] {
  const last = samples.at(-1);
  if (!last || !Number.isFinite(seconds)) return samples;
  const since = last.recordedAtUs - BigInt(seconds) * 1_000_000n;
  return samples.filter((sample) => sample.recordedAtUs >= since);
}

export interface MarketSnapshot {
  readonly logicalTick: bigint;
  readonly epoch: bigint;
  readonly priceCents: bigint;
  readonly previousTradedPriceCents: bigint;
  readonly matchedShareVolume: bigint;
  readonly volatilityBps: bigint;
  readonly actorCount: bigint;
  readonly activeActorCount: bigint;
  readonly registeredHumanTraderCount: bigint;
  readonly connectedIdentityCount: bigint;
  readonly cumulativeActorSteps: bigint;
  readonly cumulativePolicyEvaluations: bigint;
  readonly cumulativeOrdersSubmitted: bigint;
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
  readonly eventKind:
    'FILLED' | 'WIPED' | 'COOLDOWN' | 'RECAPITALIZED' | 'REVIVED' | 'UNKNOWN';
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

export function selectCapacity(
  rows: readonly (CapacityResult & { status: string; completedAt?: unknown })[],
  cadence?: Cadence,
): Pending<CapacityResult> {
  const qualified = rows.filter(
    (row) =>
      row.status === 'PASSED' &&
      row.completedAt !== undefined &&
      row.tickIntervalUs === cadence?.tickIntervalUs,
  );
  if (qualified.length === 0) return pending('No qualified run yet');
  const best = qualified.reduce((a, b) =>
    b.actorCount > a.actorCount ? b : a,
  );
  return live({
    actorCount: best.actorCount,
    tickIntervalUs: best.tickIntervalUs,
    environment: best.environment,
    workloadProfile: best.workloadProfile,
  });
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

export function asEventKind(value: string): ActivityEntry['eventKind'] {
  if (value === 'WIPED' || value === 'WIPED — DRAWDOWN LIMIT') return 'WIPED';
  if (value === 'REVIVED — INVENTORY RETAINED') return 'REVIVED';
  if (value === 'FILLED' || value === 'COOLDOWN' || value === 'RECAPITALIZED')
    return value;
  return 'UNKNOWN';
}

export function asSide(value: string): OrderSide | '' {
  return value === 'BUY' || value === 'SELL' ? value : '';
}

export function asActorStatus(value: string): ActorRow['status'] {
  return value === 'EXITING' || value === 'COOLDOWN' ? value : 'ACTIVE';
}
