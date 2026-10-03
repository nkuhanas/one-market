/**
 * Development-only sample data for reviewing states the runtime cannot produce
 * yet, such as a CHAOS shock and a populated tape.
 *
 * This is never a fallback for missing live data and never ships: every call
 * site is guarded by `import.meta.env.DEV`, which Vite replaces with `false` in
 * a production build so the bundler drops this module entirely. Reach it with
 * `?preview=chaos` while running the dev server.
 */
import {
  live,
  type ActivityEntry,
  type NewsEvent,
  type Pending,
} from '../market/contract';

export interface PreviewOverrides {
  readonly news: Pending<NewsEvent | undefined>;
  readonly activity: Pending<readonly ActivityEntry[]>;
}

const SHOCK: NewsEvent = {
  id: 1n,
  headline:
    'ONE Industries admits its lunar revenue division does not actually exist',
  direction: 'BEARISH',
  severityBps: 1800,
  confidenceBps: 7400,
  startTick: 18_400n,
  endTick: 18_800n,
};

const TAPE: readonly ActivityEntry[] = [
  {
    id: 7n,
    logicalTick: 18_462n,
    participantType: 'ACTOR',
    publicId: '#49102',
    kind: 'FILLED',
    side: 'SELL',
    quantity: 240n,
    priceCents: 8_214n,
  },
  {
    id: 6n,
    logicalTick: 18_461n,
    participantType: 'ACTOR',
    publicId: '#18291',
    kind: 'WIPED',
    lifetimePnlCents: -4_182_900n,
    wipeoutCount: 1n,
  },
  {
    id: 5n,
    logicalTick: 18_461n,
    participantType: 'HUMAN',
    publicId: '0x42AF',
    kind: 'FILLED',
    side: 'BUY',
    quantity: 60n,
    priceCents: 8_214n,
  },
  {
    id: 4n,
    logicalTick: 18_460n,
    participantType: 'ACTOR',
    publicId: '#88201',
    kind: 'FILLED',
    side: 'SELL',
    quantity: 1_020n,
    priceCents: 8_301n,
  },
];

export function previewOverrides(): PreviewOverrides | undefined {
  const requested = new URLSearchParams(window.location.search).get('preview');
  if (requested !== 'chaos') return undefined;
  return { news: live(SHOCK), activity: live(TAPE) };
}
