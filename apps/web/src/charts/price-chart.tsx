import { centsToDollars, formatDollars, formatUsd } from '../lib/units';
import type { PriceSample } from '../market/contract';

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 260;
/** Drawn points are capped so a 20 Hz redraw stays cheap on a phone. */
const MAX_DRAWN_POINTS = 240;

function downsample(samples: readonly PriceSample[]): PriceSample[] {
  if (samples.length <= MAX_DRAWN_POINTS) return [...samples];
  const stride = samples.length / MAX_DRAWN_POINTS;
  const drawn: PriceSample[] = [];
  for (let index = 0; index < MAX_DRAWN_POINTS; index += 1) {
    drawn.push(samples[Math.floor(index * stride)]);
  }
  const last = samples[samples.length - 1];
  if (drawn[drawn.length - 1] !== last) drawn.push(last);
  return drawn;
}

export function PriceChart({
  samples,
  clientObserved,
}: {
  samples: readonly PriceSample[];
  clientObserved: boolean;
}) {
  const drawn = downsample(samples);
  const source = clientObserved
    ? `${samples.length} ticks watched by this browser. Server price history arrives with PricePoint.`
    : `Last ${samples.length} ticks of server price history.`;

  if (drawn.length < 2) {
    return (
      <figure className="chart chart-empty">
        <p>Watching for the next tick. The line starts drawing immediately.</p>
      </figure>
    );
  }

  const dollars = drawn.map((sample) =>
    centsToDollars(sample.priceCents, 'price_cents'),
  );
  const low = Math.min(...dollars);
  const high = Math.max(...dollars);
  // A price that never moves is a valid market outcome, not a failure state:
  // centre the line instead of dividing by a zero range, and drop the area
  // fill so a flat reading does not render as a solid block.
  const flat = high === low;
  const span = high - low || 1;
  const padding = span * 0.12;
  const floor = low - padding;
  const ceiling = high + padding;

  const points = dollars.map((value, index) => {
    const x = (index / (dollars.length - 1)) * VIEW_WIDTH;
    const y = VIEW_HEIGHT - ((value - floor) / (ceiling - floor)) * VIEW_HEIGHT;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${points.join(' L')}`;
  const area = `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`;
  const first = dollars[0];
  const last = dollars[dollars.length - 1];
  const direction = flat ? 'flat' : last > first ? 'up' : 'down';
  const latest = drawn[drawn.length - 1];

  return (
    <figure className={`chart chart-${direction}`}>
      <div className="chart-canvas">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Price of ONE across the last ${samples.length} observed ticks, currently ${formatUsd(latest.priceCents)}`}
        >
          {!flat && <path className="chart-area" d={area} />}
          <path className="chart-line" d={line} />
        </svg>
        {/* Scale labels sit outside the SVG because the chart stretches to fit
            its container, which would distort any text drawn inside it. */}
        <div className={`chart-scale ${flat ? 'chart-scale-flat' : ''}`}>
          {flat ? (
            <span>{formatDollars(high)}</span>
          ) : (
            <>
              <span>{formatDollars(ceiling)}</span>
              <span>{formatDollars(floor)}</span>
            </>
          )}
        </div>
      </div>
      <figcaption>
        {flat ? `Price has not moved. ${source}` : source}
      </figcaption>
    </figure>
  );
}
