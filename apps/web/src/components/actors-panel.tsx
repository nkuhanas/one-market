import { memo } from 'react';
import { formatSignedUsd, formatUsd } from '../lib/units';
import type { ActorRow } from '../market/contract';
import { AgentAvatar } from './agent-avatar';
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
  // A leaderboard, not the order the sample happened to arrive in. Richest
  // first, with ties broken by id so the list cannot flicker between equal
  // agents while the sample refreshes.
  const ranked = [...actors].sort((a, b) =>
    a.markedEquityCents === b.markedEquityCents
      ? Number(a.actorId - b.actorId)
      : b.markedEquityCents > a.markedEquityCents
        ? 1
        : -1,
  );

  return (
    <section className="panel" id="actors">
      <div className="panel-head">
        <h2>Autonomous agents</h2>
        <span className="panel-note">
          {actors.length > 0 && actorCount !== undefined
            ? `Top ${Math.min(actors.length, 40)} of a ${actors.length} agent sample`
            : 'Public sample'}
        </span>
      </div>

      {actors.length === 0 ? (
        <EmptyState
          compact
          title="No agents in the world"
          body="Each agent holds its own cash, shares and policy weights, and is stepped once per epoch. They appear here once the population is initialized."
        />
      ) : (
        <ol className="rows">
          {ranked.slice(0, 40).map((actor, index) => (
            <li key={String(actor.actorId)} className="row row-actor">
              <span className="rank mono">{index + 1}</span>
              <AgentAvatar
                id={String(actor.actorId)}
                dead={actor.status !== 'ACTIVE'}
              />
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
