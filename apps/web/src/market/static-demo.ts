import type {
  ActivityEntry,
  ActorRow,
  Cadence,
  MarketSnapshot,
  PriceSample,
} from './contract';

/** Illustrative fixtures, not a captured production world or benchmark evidence. */
export const DEMO_CADENCE: Cadence = {
  profile: '4hz',
  tickIntervalUs: 250_000n,
  bucketCount: 20,
};
const START_US = 1_791_072_000_000_000n;
export const DEMO_PRICES: readonly PriceSample[] = Array.from(
  { length: 721 },
  (_, i) => ({
    logicalTick: 18_000n + BigInt(i),
    recordedAtUs: START_US + BigInt(i) * DEMO_CADENCE.tickIntervalUs,
    priceCents: BigInt(
      Math.round(
        10_000 - i * 0.6 + Math.sin(i / 58) * 140 + Math.sin(i / 7) * 27,
      ),
    ),
    matchedShareVolume: BigInt(48_000 + ((i * 7919) % 32_000)),
  }),
);
const last = DEMO_PRICES[DEMO_PRICES.length - 1];
export const DEMO_SNAPSHOT: MarketSnapshot = {
  logicalTick: last.logicalTick,
  epoch: last.logicalTick / 20n,
  priceCents: last.priceCents,
  previousTradedPriceCents: DEMO_PRICES[DEMO_PRICES.length - 2].priceCents,
  matchedShareVolume: last.matchedShareVolume,
  volatilityBps: 124n,
  actorCount: 1_000_000n,
  activeActorCount: 998_472n,
  registeredHumanTraderCount: 12n,
  connectedIdentityCount: 0n,
  cumulativeActorSteps: 936_000_000n,
  cumulativePolicyEvaluations: 932_000_000n,
  cumulativeOrdersSubmitted: 704_000_000n,
  cumulativeOrdersFilled: 698_000_000n,
  cumulativeMatchedShareVolume: 1_175_000_000n,
  rateWindowUs: 1_000_000n,
  chaosActive: false,
  phase: 'STATIC DEMO',
};
export const DEMO_ACTORS: readonly ActorRow[] = Array.from(
  { length: 64 },
  (_, i) => ({
    actorId: BigInt(i + 1),
    status: i === 8 ? 'EXITING' : i === 15 ? 'COOLDOWN' : 'ACTIVE',
    markedEquityCents: BigInt(320_000 + ((i * 104729) % 380_000)),
    lifetimePnlCents: BigInt(-180_000 + ((i * 104729) % 380_000)),
    wipeoutCount: BigInt(i === 8 || i === 15 ? 1 : 0),
  }),
);
export const DEMO_ACTIVITY: readonly ActivityEntry[] = Array.from(
  { length: 24 },
  (_, i) => ({
    id: BigInt(100 - i),
    logicalTick: last.logicalTick - BigInt(i),
    participantType: i % 9 === 0 ? 'HUMAN' : 'ACTOR',
    participantId: i % 9 === 0 ? '0x7a…42bf' : String(1 + ((i * 17) % 64)),
    eventKind: 'FILLED',
    side: i % 2 === 0 ? 'BUY' : 'SELL',
    quantity: BigInt(1 + ((i * 3) % 10)),
    priceCents: DEMO_PRICES[DEMO_PRICES.length - 1 - i].priceCents,
    lifetimePnlCents: 0n,
    wipeoutCount: 0n,
  }),
);
export const DEMO_LIFECYCLE: readonly ActivityEntry[] = (
  ['WIPED', 'COOLDOWN', 'RECAPITALIZED', 'REVIVED'] as const
).map((eventKind, i) => ({
  id: BigInt(200 - i),
  logicalTick: last.logicalTick - BigInt(20 * (i + 1)),
  participantType: 'ACTOR',
  participantId: String(9 + i * 7),
  eventKind,
  side: '',
  quantity: 0n,
  priceCents: last.priceCents,
  lifetimePnlCents: BigInt(-260_000 - i * 12300),
  wipeoutCount: BigInt(1 + i),
}));
