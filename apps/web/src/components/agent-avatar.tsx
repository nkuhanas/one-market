/**
 * A deterministic mark for one agent.
 *
 * Everything here is derived from the agent's own id, so the same agent always
 * looks the same in every panel and on every machine, and nothing is invented:
 * the drawing is a rendering of the identifier, not data about the agent.
 *
 * Hues avoid the red and green arcs, which report market direction elsewhere
 * and must not read as a signal here.
 */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const EYES = ['round', 'slit', 'wide', 'dot'] as const;
const MOUTHS = ['flat', 'frown', 'open', 'smirk'] as const;

export function AgentAvatar({
  id,
  dead = false,
  size = 22,
}: {
  id: string;
  dead?: boolean;
  size?: number;
}) {
  const h = hash(id);
  // 160–280° spans teal through blue to indigo, clear of the direction colours.
  const hue = 160 + (h % 120);
  const eyes = EYES[(h >> 7) % EYES.length];
  const mouth = MOUTHS[(h >> 11) % MOUTHS.length];
  const tilt = ((h >> 17) % 5) - 2;

  const skin = dead ? 'hsl(215 12% 26%)' : `hsl(${hue} 42% 32%)`;
  const ink = dead ? 'hsl(215 10% 48%)' : `hsl(${hue} 70% 78%)`;

  return (
    <svg
      className="avatar"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="22" height="22" rx="7" fill={skin} />
      <g transform={`rotate(${tilt} 12 12)`} fill={ink} stroke={ink}>
        {eyes === 'round' && (
          <>
            <circle cx="8.5" cy="10" r="1.6" />
            <circle cx="15.5" cy="10" r="1.6" />
          </>
        )}
        {eyes === 'slit' && (
          <>
            <rect x="6.6" y="9.3" width="4" height="1.5" rx="0.75" />
            <rect x="13.4" y="9.3" width="4" height="1.5" rx="0.75" />
          </>
        )}
        {eyes === 'wide' && (
          <>
            <circle cx="8.3" cy="10" r="2.2" />
            <circle cx="15.7" cy="10" r="2.2" />
          </>
        )}
        {eyes === 'dot' && (
          <>
            <circle cx="8.8" cy="10" r="1" />
            <circle cx="15.2" cy="10" r="1" />
          </>
        )}

        {mouth === 'flat' && (
          <rect x="8" y="15.4" width="8" height="1.5" rx="0.75" />
        )}
        {mouth === 'frown' && (
          <path
            d="M8 17.2 Q12 14.2 16 17.2"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )}
        {mouth === 'open' && <ellipse cx="12" cy="16.2" rx="2.4" ry="2" />}
        {mouth === 'smirk' && (
          <path
            d="M8.6 15.6 Q12 17.8 15.4 15.2"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        )}
      </g>
      {dead && (
        <g stroke="hsl(215 10% 55%)" strokeWidth="1.6" strokeLinecap="round">
          <path d="M6.6 7.6 L10.4 11.4 M10.4 7.6 L6.6 11.4" />
          <path d="M13.6 7.6 L17.4 11.4 M17.4 7.6 L13.6 11.4" />
        </g>
      )}
    </svg>
  );
}
