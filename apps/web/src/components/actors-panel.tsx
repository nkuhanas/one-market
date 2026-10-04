import { memo } from 'react';
import { formatSignedUsd, formatUsd } from '../lib/units';
import type { ActorRow } from '../market/contract';
import { EmptyState } from './value';

const STATUS_COPY: Record<ActorRow['status'], string> = {
  ACTIVE: 'Trading',
  EXITING: 'Liquidating',
  COOLDOWN: 'Cooling down',
};

export const ActorsPanel = memo(function ActorsPanel({
  actors,
  actorCount,
}: {
  actors: readonly ActorRow[];
  actorCount?: bigint;
}) {
  return (
    <section className="panel" id="actors">
      <div className="panel-head">
        <h2>Autonomous actors</h2>
        <span className="panel-note">
          {actors.length > 0 && actorCount !== undefined
            ? `Sample of ${actors.length} from the population`
            : 'Public sample'}
        </span>
      </div>

      {actors.length === 0 ? (
        <EmptyState
          compact
          title="No actors in the world"
          body="Each actor holds its own cash, shares and policy weights, and is stepped once per epoch. They appear here once the population is initialized."
        />
      ) : (
        <ol className="rows">
          {actors.slice(0, 40).map((actor) => (
            <li key={String(actor.actorId)} className="row row-actor">
              <span className="row-tick mono">#{String(actor.actorId)}</span>
              <span className={`status status-${actor.status.toLowerCase()}`}>
                {STATUS_COPY[actor.status]}
              </span>
              <span className="row-detail mono">
                {formatUsd(actor.markedEquityCents, 'marked_equity_cents')}
              </span>
              <span
                className={`row-detail mono ${actor.lifetimePnlCents < 0n ? 'tone-down' : 'tone-up'}`}
              >
                {formatSignedUsd(actor.lifetimePnlCents)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});
