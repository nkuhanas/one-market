/**
 * Unit conversions for the client contract in SPEC.md section 12.
 *
 * Money is integer cents, percentages are integer basis points, and durations
 * are integer microseconds. The SDK exposes 64-bit columns as `bigint`; those
 * values stay `bigint` until a display or charting step needs a `number`, and
 * every narrowing conversion is range checked here rather than at the call
 * site.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

/** Narrows a 64-bit value, refusing silently lossy conversions. */
export function toNumberChecked(value: bigint, field: string): number {
  if (value > MAX_SAFE || value < MIN_SAFE) {
    throw new RangeError(
      `${field} is outside the safe integer range and cannot be narrowed: ${value}`,
    );
  }
  return Number(value);
}

/** Converts integer cents to a dollar amount without losing the cents. */
export function centsToDollars(cents: bigint, field = 'cents'): number {
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const whole = toNumberChecked(magnitude / 100n, field);
  const fraction = Number(magnitude % 100n) / 100;
  const dollars = whole + fraction;
  return negative ? -dollars : dollars;
}

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatUsd(cents: bigint, field = 'price_cents'): string {
  return usdFormat.format(centsToDollars(cents, field));
}

const countFormat = new Intl.NumberFormat('en-US');

export function formatCount(value: bigint): string {
  return countFormat.format(value);
}

const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Compact form for large populations, e.g. `487.5K`. Keeps `bigint` input. */
export function formatCompact(value: bigint): string {
  return compactFormat.format(value);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function formatSignedPercent(bps: number): string {
  const percent = bpsToPercent(bps);
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(2)}%`;
}

/**
 * Price change in basis points. Returns undefined when there is no usable
 * reference price rather than inventing a zero.
 */
export function changeBps(
  current: bigint,
  previous: bigint,
): number | undefined {
  if (previous <= 0n) return undefined;
  return toNumberChecked(
    ((current - previous) * 10_000n) / previous,
    'change_bps',
  );
}

/**
 * Rate per second from a counter delta and the actual elapsed time, per
 * section 12: twenty completed ticks cannot be assumed to be one second.
 */
export function ratePerSecond(
  countDelta: bigint,
  elapsedUs: bigint,
): number | undefined {
  if (elapsedUs <= 0n || countDelta < 0n) return undefined;
  const thousandths = (countDelta * 1_000_000_000n) / elapsedUs;
  return toNumberChecked(thousandths, 'rate_per_second') / 1000;
}

export function microsToMillis(us: bigint): number {
  return toNumberChecked(us, 'duration_us') / 1000;
}

/** Formats an already-converted dollar amount, for chart scale labels. */
export function formatDollars(value: number): string {
  return usdFormat.format(value);
}

/** Shares, orders and other whole counts. */
export function formatShares(value: bigint): string {
  return countFormat.format(value);
}

/** Signed money, for P&L columns where the sign carries the meaning. */
export function formatSignedUsd(cents: bigint, field = 'pnl_cents'): string {
  const text = usdFormat.format(centsToDollars(cents, field));
  return cents > 0n ? `+${text}` : text;
}

/** A tick count expressed as elapsed simulation time at the target cadence. */
export function ticksToSeconds(ticks: bigint, hz: number): number {
  return toNumberChecked(ticks, 'ticks') / hz;
}
