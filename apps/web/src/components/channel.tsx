import type { ReactNode } from 'react';
import type { Pending } from '../market/contract';

/**
 * A single readout. A pending channel states what it is waiting for instead of
 * showing a zero, so nobody reads an unimplemented surface as a measurement.
 */
export function Channel({
  label,
  value,
  note,
}: {
  label: string;
  value: Pending<ReactNode>;
  note?: string;
}) {
  if (value.state === 'pending') {
    return (
      <article className="channel channel-pending">
        <h3>{label}</h3>
        <p className="channel-value">Awaiting runtime</p>
        <p className="channel-note">{value.reason}</p>
      </article>
    );
  }
  return (
    <article className="channel">
      <h3>{label}</h3>
      <p className="channel-value">{value.value}</p>
      {note && <p className="channel-note">{note}</p>}
    </article>
  );
}
