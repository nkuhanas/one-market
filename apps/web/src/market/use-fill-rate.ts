import { useEffect, useRef, useState } from 'react';
import { toNumberChecked } from '../lib/units';

/** How long a sample must span before a rate is worth showing. */
const MIN_WINDOW_MS = 3000;
const SAMPLE_MS = 1000;

/**
 * Filled orders per second, derived from the change in a cumulative counter
 * over actual elapsed wall time (SPEC.md section 12 forbids inferring elapsed
 * time from tick counts).
 *
 * This is a client-side observation, not a server measurement: the runtime
 * publishes cumulative totals and a window length, but not the counter value at
 * the window's start, so a rate cannot be read from one row. The caller labels
 * it as observed by this browser.
 */
export function useFillRate(cumulative?: bigint): number | undefined {
  const [rate, setRate] = useState<number>();
  const anchor = useRef<{ count: bigint; at: number } | undefined>(undefined);
  const latest = useRef<bigint | undefined>(undefined);
  latest.current = cumulative;

  useEffect(() => {
    const timer = setInterval(() => {
      const count = latest.current;
      if (count === undefined) return;
      const now = Date.now();
      if (!anchor.current) {
        anchor.current = { count, at: now };
        return;
      }
      const elapsed = now - anchor.current.at;
      if (elapsed < MIN_WINDOW_MS) return;
      const delta = count - anchor.current.count;
      anchor.current = { count, at: now };
      if (delta < 0n) {
        // The world was reset underneath us; start a fresh window.
        setRate(undefined);
        return;
      }
      setRate((toNumberChecked(delta, 'orders_filled_delta') * 1000) / elapsed);
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);

  return rate;
}
