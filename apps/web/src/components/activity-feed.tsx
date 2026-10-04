import { memo } from 'react';
import {
  formatCount,
  formatShares,
  formatSignedUsd,
  formatUsd,
} from '../lib/units';
import type { ActivityEntry } from '../market/contract';
import { EmptyState } from './value';

function Row({ entry }: { entry: ActivityEntry }) {
  const human = entry.participantType === 'HUMAN';
  if (entry.eventKind !== 'FILLED') {
    const wiped = entry.eventKind === 'WIPED';
    const label = {
      WIPED: 'Wiped — drawdown limit',
      COOLDOWN: 'Cooldown — shares sold',
      RECAPITALIZED: 'Recapitalized',
      REVIVED: 'Revived — shares retained',
      UNKNOWN: 'Lifecycle update',
    }[entry.eventKind];
    return (
      <li className={`row${wiped ? ' row-wiped' : ''}`}>
        <span className="row-tick mono">{formatCount(entry.logicalTick)}</span>
        <span className="row-who">
          {human ? 'Human' : 'Agent'}{' '}
          <span className="mono">{entry.participantId}</span>
        </span>
        {/* Section 12 fixes the wipeout wording, and it must not imply that
            the agent's shares have finished liquidating. */}
        <span className={`row-kind${wiped ? ' kind-wiped' : ''}`}>{label}</span>
        <span className="row-detail mono">
          {formatSignedUsd(entry.lifetimePnlCents)} lifetime
        </span>
      </li>
    );
  }
  const buy = entry.side === 'BUY';
  return (
    <li className="row">
      <span className="row-tick mono">{formatCount(entry.logicalTick)}</span>
      <span className="row-who">
        {human ? 'Human' : 'Agent'}{' '}
        <span className="mono">{entry.participantId}</span>
      </span>
      <span className={`row-kind ${buy ? 'kind-buy' : 'kind-sell'}`}>
        {buy ? 'Bought' : 'Sold'} {formatShares(entry.quantity)}
      </span>
      <span className="row-detail mono">{formatUsd(entry.priceCents)}</span>
    </li>
  );
}

export const ActivityFeed = memo(function ActivityFeed({
  activity,
}: {
  activity: readonly ActivityEntry[];
}) {
  return (
    <section className="panel" id="activity">
      <div className="panel-head">
        <h2>Live activity</h2>
        <span className="panel-note">
          Sampled feed, not a throughput measure
        </span>
      </div>
      {activity.length === 0 ? (
        <EmptyState
          compact
          title="No activity yet"
          body="Fills, drawdown wipeouts, and actor recovery events appear here as the simulation advances."
        />
      ) : (
        <ol className="rows">
          {activity.slice(0, 40).map((entry) => (
            <Row key={String(entry.id)} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
});
