import { formatCount } from '../lib/units';
import {
  cadenceLabel,
  type Cadence,
  type ConnectionStatus,
} from '../market/contract';

const SECTIONS = [
  { id: 'market', label: 'Market' },
  { id: 'actors', label: 'Agents' },
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
        <img
          className="brand-mark"
          src="/one-market-mark.png"
          alt=""
          width={197}
          height={128}
        />
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
        {/* The tick changes frequently and is deliberately not a
            live region. Connection state is the one status worth announcing,
            and it is announced once, atomically, with context. */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {liveNow
            ? 'Connected to the live market'
            : status === 'Connecting'
              ? 'Connecting to the market'
              : 'Market connection lost'}
        </span>
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
