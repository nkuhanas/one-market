import { memo } from 'react';
import { formatCount, formatSignedUsd } from '../lib/units';
import type { ActivityEntry } from '../market/contract';
import { AgentAvatar } from './agent-avatar';
import { EmptyState } from './value';

/**
 * Lifecycle events only: who was forced out, who came back.
 *
 * These are watched as they arrive rather than read from the public feed. That
 * feed keeps 500 entries and fills land in the hundreds per second, so a
 * wipeout survives in it for a few seconds at most.
 */
const LABEL: Record<Exclude<ActivityEntry['eventKind'], 'FILLED'>, string> = {
  WIPED: 'Wiped out',
  COOLDOWN: 'Sold out, cooling down',
  RECAPITALIZED: 'Staked again',
  REVIVED: 'Revived, inventory kept',
  UNKNOWN: 'Lifecycle update',
};

export const KillFeed = memo(function KillFeed({
  kills,
  staticDemo = false,
}: {
  kills: readonly ActivityEntry[];
  staticDemo?: boolean;
}) {
  return (
    <section className="panel" id="kills">
      <div className="panel-head">
        <h2>Kill feed</h2>
        <span className="panel-note">
          {staticDemo
            ? 'Static lifecycle examples'
            : 'Watched live by this browser'}
        </span>
      </div>

      {kills.length === 0 ? (
        <EmptyState
          compact
          title="Nobody has blown up yet"
          body="An agent that falls far enough below its own peak is forced to liquidate. When one goes, it lands here."
        />
      ) : (
        <ol className="rows">
          {kills.slice(0, 40).map((entry) => {
            const kind = entry.eventKind;
            if (kind === 'FILLED') return null;
            const gone = kind === 'WIPED' || kind === 'COOLDOWN';
            return (
              <li key={String(entry.id)} className="row row-kill">
                <AgentAvatar id={entry.participantId} dead={gone} />
                <span className="row-who">
                  {entry.participantType === 'HUMAN' ? 'Human' : 'Agent'}{' '}
                  <span className="mono">{entry.participantId}</span>
                </span>
                <span
                  className={`row-kind ${gone ? 'kind-wiped' : 'kind-revived'}`}
                >
                  {LABEL[kind]}
                </span>
                <span
                  className={`row-detail mono ${
                    entry.lifetimePnlCents < 0n ? 'tone-down' : 'tone-up'
                  }`}
                >
                  {formatSignedUsd(entry.lifetimePnlCents)}
                </span>
                <span className="row-detail mono row-deaths">
                  {formatCount(entry.wipeoutCount)}×
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
});
