import type { DbConnection } from '../private-bindings';
import type { ActorState } from '../private-bindings/types';

/** Canonical logical rows: tests must never silently ignore either storage tier. */
export function actorRows(connection: DbConnection): ActorState[] {
  const rows = [...connection.db.actorState.iter()];
  for (const a of connection.db.actorStateCompact.iter()) {
    if ((a.flags & ~15) !== 0 || (a.flags & 3) === 3)
      throw new Error('Invalid compact actor flags');
    rows.push({
      actorId: a.actorId,
      bucket: a.bucket,
      cashCents: BigInt(a.cashCents),
      shares: BigInt(a.shares),
      markedEquityCents: BigInt(a.markedEquityCents),
      initialEndowmentValueCents: BigInt(a.initialEndowmentValueCents),
      lifePeakEquityCents: BigInt(a.lifePeakEquityCents),
      cumulativeRecapitalizationGrantsCents: BigInt(
        a.cumulativeRecapitalizationGrantsCents,
      ),
      momentumWeight: a.momentumWeight,
      meanReversionWeight: a.meanReversionWeight,
      contrarianWeight: a.contrarianWeight,
      newsWeight: a.newsWeight,
      riskToleranceBps: BigInt(a.riskToleranceBps),
      convictionThresholdBps: BigInt(a.convictionThresholdBps),
      lastStepTick: {
        value: a.lastStepTickValue,
        present: (a.flags & 4) !== 0,
      },
      status: {
        tag: (['Active', 'Exiting', 'Cooldown'] as const)[a.flags & 3],
        value: {},
      },
      cooldownStartedTick: {
        value: a.cooldownStartedTickValue,
        present: (a.flags & 8) !== 0,
      },
      lifetimePnlCents: BigInt(a.lifetimePnlCents),
      wipeoutCount: BigInt(a.wipeoutCount),
      filledOrderCount: BigInt(a.filledOrderCount),
    });
  }
  rows.sort((a, b) =>
    a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0,
  );
  if (new Set(rows.map((a) => a.actorId)).size !== rows.length)
    throw new Error('Duplicate actor storage');
  return rows;
}

export function actorRow(connection: DbConnection, id: bigint) {
  return actorRows(connection).find((a) => a.actorId === id);
}
