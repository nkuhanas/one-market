import { centsToDollars, formatDollars } from '../lib/units';
import type { PriceSample } from '../market/contract';

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 300;
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

export interface PriceChartView {
  readonly element: React.ReactNode;
  readonly direction: 'up' | 'down' | 'flat' | 'empty';
  readonly caption: string;
}

/**
 * The price line, drawn to fill whatever it is given. It sits behind the hero
 * readout, so it carries no labels of its own: the surrounding layout owns the
 * price, the scale and the caption.
 */
export function priceChartView({
  samples,
  clientObserved,
}: {
  samples: readonly PriceSample[];
  clientObserved: boolean;
}): PriceChartView {
  const drawn = downsample(samples);
  const source = clientObserved
    ? `${samples.length} ticks watched by this browser`
    : `last ${samples.length} ticks of server history`;

  if (drawn.length < 2) {
    return {
      element: null,
      direction: 'empty',
      caption: 'Watching for the next tick',
    };
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
  const padding = span * 0.18;
  const floor = low - padding;
  const ceiling = high + padding;

  const points = dollars.map((value, index) => {
    const x = (index / (dollars.length - 1)) * VIEW_WIDTH;
    const y = VIEW_HEIGHT - ((value - floor) / (ceiling - floor)) * VIEW_HEIGHT;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${points.join(' L')}`;
  const area = `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`;
  const direction = flat
    ? 'flat'
    : dollars[dollars.length - 1] > dollars[0]
      ? 'up'
      : 'down';

  return {
    direction,
    caption: flat
      ? `Price has not moved · ${source} · server history arrives with PricePoint`
      : `${formatDollars(low)}–${formatDollars(high)} · ${source}`,
    element: (
      <svg
        className="price-line"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {!flat && <path className="chart-area" d={area} />}
        <path className="chart-line" d={line} />
      </svg>
    ),
  };
}
