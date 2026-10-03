import { TICKS_PER_EPOCH } from '../market/contract';

const SLOTS = Array.from({ length: TICKS_PER_EPOCH }, (_, index) => index);

/**
 * One bar per tick slot in a logical epoch (SPEC.md section 5). The lit slot is
 * `logical_tick % 20`, so the sweep completes once per epoch, which is one
 * second of wall time only while the cadence holds.
 */
export function EpochMeter({ slot }: { slot: number }) {
  return (
    <div className="epoch-meter" aria-hidden="true">
      {SLOTS.map((index) => (
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
  );
}
