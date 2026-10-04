import { formatCount } from '../lib/units';
import {
  cadenceLabel,
  epochSlot,
  type Cadence,
  type MarketSnapshot,
} from '../market/contract';

/** Live simulation position, independent of the chart's selected history range. */
export function MarketClock({
  snapshot,
  cadence,
}: {
  snapshot?: Pick<MarketSnapshot, 'logicalTick' | 'epoch'>;
  cadence?: Cadence;
}) {
  const buckets = cadence?.bucketCount ?? 0;
  const slot = epochSlot(snapshot?.logicalTick, buckets);

  return (
    <div className="market-clock" role="group" aria-label="Simulation clock">
      {slot !== undefined && (
        <div className="epoch" aria-hidden="true">
          {Array.from({ length: buckets }, (_, index) => (
            <span
              key={index}
              className={
                index === slot
                  ? 'slot slot-now'
                  : index < slot
                    ? 'slot slot-done'
                    : 'slot'
              }
            />
          ))}
        </div>
      )}
      <p className="market-clock-line">
        {snapshot && slot !== undefined ? (
          <>
            <span>
              Epoch <span className="mono">{formatCount(snapshot.epoch)}</span>
            </span>
            <span>
              Bucket{' '}
              <span className="mono">
                {slot + 1} of {buckets}
              </span>
            </span>
          </>
        ) : (
          <span>Waiting for the shared clock</span>
        )}
        <span>{cadenceLabel(cadence)}</span>
      </p>
    </div>
  );
}
