import { formatCount } from '../lib/units';
import {
  cadenceLabel,
  type Cadence,
  type ConnectionStatus,
} from '../market/contract';

const SECTIONS = [
  { id: 'market', label: 'Market' },
  { id: 'actors', label: 'Actors' },
  { id: 'activity', label: 'Activity' },
  { id: 'system', label: 'System' },
];

export function Header({
  status,
  logicalTick,
  cadence,
}: {
  status: ConnectionStatus;
  logicalTick?: bigint;
  cadence?: Cadence;
}) {
  const liveNow = status === 'Connected';
  return (
    <header className="header">
      <a className="brand" href="#market">
        <span className="brand-mark" aria-hidden="true" />
        One Market
      </a>

      <nav className="nav" aria-label="Sections">
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.label}
          </a>
        ))}
      </nav>

      <div className="header-system">
        <span
          className={`live ${liveNow ? 'live-on' : ''}`}
          data-testid="connection-status"
        >
          {status}
        </span>
        <span className="header-tick">
          <span className="header-tick-label">Tick</span>
          <span className="mono" data-testid="tick">
            {logicalTick === undefined ? '—' : formatCount(logicalTick)}
          </span>
        </span>
        <span className="header-hz">{cadenceLabel(cadence)}</span>
      </div>
    </header>
  );
}
