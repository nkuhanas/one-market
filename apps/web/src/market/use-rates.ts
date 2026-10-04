import { useEffect, useRef, useState } from 'react';
import { toNumberChecked } from '../lib/units';

const MIN_WINDOW_MS = 3000;
const SAMPLE_MS = 1000;

/**
 * Per-second rates derived from the change in cumulative counters over actual
 * elapsed wall time. SPEC.md section 12 forbids inferring elapsed time from
 * tick counts, and the runtime publishes totals rather than per-window values,
 * so a rate cannot be read from a single row: the browser measures it.
 *
 * Every counter is sampled against the same clock, so the rates are comparable
 * with each other.
 */
export function useRates<K extends string>(
  counters: Record<K, bigint> | undefined,
): Partial<Record<K, number>> {
  const [rates, setRates] = useState<Partial<Record<K, number>>>({});
  const anchor = useRef<
    { at: number; values: Record<string, bigint> } | undefined
  >(undefined);
  const latest = useRef(counters);
  latest.current = counters;

  useEffect(() => {
    const timer = setInterval(() => {
      const current = latest.current;
      if (!current) return;
      const now = Date.now();
      const values = { ...current } as Record<string, bigint>;

      if (!anchor.current) {
        anchor.current = { at: now, values };
        return;
      }
      const elapsed = now - anchor.current.at;
      if (elapsed < MIN_WINDOW_MS) return;

      const previous = anchor.current.values;
      anchor.current = { at: now, values };

      const next: Record<string, number> = {};
      let reset = false;
      for (const key of Object.keys(values)) {
        const delta = values[key] - (previous[key] ?? 0n);
        // A negative delta means the world was rebuilt underneath us.
        if (delta < 0n) reset = true;
        else next[key] = (toNumberChecked(delta, key) * 1000) / elapsed;
      }
      setRates(reset ? {} : (next as Partial<Record<K, number>>));
    }, SAMPLE_MS);
    return () => clearInterval(timer);
  }, []);

  return rates;
}
