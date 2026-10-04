import { formatCount, formatUsd } from '../lib/units';
import type { ActivityEntry, Pending } from '../market/contract';

function describe(entry: ActivityEntry) {
  if (entry.kind === 'WIPED') {
    // Section 12 fixes this wording, and it must not imply that the actor's
    // shares have finished liquidating.
    return (
      <>
        <span className="tape-event tape-wiped">WIPED — DRAWDOWN LIMIT</span>
        <span className="tape-detail">
          {formatUsd(entry.lifetimePnlCents, 'lifetime_pnl_cents')} lifetime,
          wipeout {formatCount(entry.wipeoutCount)}
        </span>
      </>
    );
  }
  return (
    <>
      <span className={`tape-event tape-${entry.side.toLowerCase()}`}>
        {entry.side} filled
      </span>
      <span className="tape-detail">
        {formatCount(entry.quantity)} at {formatUsd(entry.priceCents)}
      </span>
    </>
  );
}

export function ActivityTape({
  activity,
}: {
  activity: Pending<readonly ActivityEntry[]>;
}) {
  if (activity.state === 'pending') {
    return (
      <section className="tape" aria-label="Market activity">
        <h2>Activity</h2>
        <p className="tape-empty">
          Fills, drawdown wipeouts, and news land here once the auction runs.
          Nothing is on the tape yet.
        </p>
      </section>
    );
  }

  if (activity.value.length === 0) {
    return (
      <section className="tape" aria-label="Market activity">
        <h2>Activity</h2>
        <p className="tape-empty">
          The market is running and nobody has traded yet. Place an order to be
          first on the tape.
        </p>
      </section>
    );
  }

  return (
    <section className="tape" aria-label="Market activity">
      <h2>Activity</h2>
      <ol className="tape-list">
        {activity.value.map((entry) => (
          <li key={String(entry.id)}>
            <span className="tape-who">
              {entry.participantType === 'HUMAN' ? 'Human' : 'Actor'}{' '}
              {entry.publicId}
            </span>
            {describe(entry)}
          </li>
        ))}
      </ol>
    </section>
  );
}
