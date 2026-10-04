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
  if (entry.eventKind === 'WIPED') {
    return (
      <li className="row row-wiped">
        <span className="row-tick mono">{formatCount(entry.logicalTick)}</span>
        <span className="row-who">
          {human ? 'Human' : 'Actor'}{' '}
          <span className="mono">{entry.participantId}</span>
        </span>
        {/* Section 12 fixes this wording, and it must not imply that the
            actor's shares have finished liquidating. */}
        <span className="row-kind kind-wiped">Wiped — drawdown limit</span>
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
        {human ? 'Human' : 'Actor'}{' '}
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
          title="No trades yet"
          body="Fills and drawdown wipeouts appear here as soon as an auction clears."
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
