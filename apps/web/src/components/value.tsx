import type { ReactNode } from 'react';
import type { Pending } from '../market/contract';

/**
 * Renders a metric that may not have a source yet. A pending metric states what
 * it is waiting for instead of showing a zero, so an unimplemented surface can
 * never be read as a measurement (SPEC.md section 14).
 */
export function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value:
    | Pending<ReactNode>
    | { readonly state: 'sample'; readonly value: ReactNode };
  hint?: string;
  tone?: 'neutral' | 'accent' | 'up' | 'down';
}) {
  const waiting = value.state === 'pending';
  return (
    <div className={`metric ${waiting ? 'metric-waiting' : ''}`}>
      <span className="metric-label">{label}</span>
      <span className={`metric-value tone-${waiting ? 'muted' : tone}`}>
        {waiting ? '—' : value.value}
      </span>
      <span className="metric-hint">{waiting ? value.reason : hint}</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${compact ? 'empty-compact' : ''}`}>
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
    </div>
  );
}
