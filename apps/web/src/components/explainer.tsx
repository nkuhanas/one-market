import { useState } from 'react';
import { TARGET_HZ } from '../market/contract';

const STEPS = [
  {
    title: 'One shared world',
    body: 'Not a copy each. One row of state, and every browser is watching it.',
  },
  {
    title: 'Agents decide for themselves',
    body: 'Each one has its own cash, shares and strategy. Small policies, not language models.',
  },
  {
    title: 'One auction per tick',
    body: 'Every order clears at a single price. Nothing rests on a book.',
  },
  {
    title: 'Losses are real',
    body: 'Fall far enough and you are liquidated. Nobody props the price up.',
  },
];

/**
 * A marquee rather than a slideshow: the track glides continuously and never
 * waits for a click. The steps are rendered twice and the track travels exactly
 * half its width, so the second copy is under the cursor at the moment the
 * animation restarts and the loop has no seam. The duplicate is hidden from
 * assistive technology, which reads the first copy once.
 */
export function Explainer() {
  const [running, setRunning] = useState(true);

  return (
    <section className="explain" id="how">
      <div className="explain-head" data-reveal>
        <h2>How it works</h2>
        <p>
          A market anyone can read, run by agents at {TARGET_HZ} ticks a second.
        </p>
      </div>

      <div className="marquee" data-reveal>
        <ol
          className={`marquee-track ${running ? '' : 'marquee-paused'}`}
          aria-label="How it works"
        >
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="marquee-index mono">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
          {STEPS.map((step, i) => (
            <li key={`${step.title}-echo`} aria-hidden="true">
              <span className="marquee-index mono">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="explain-foot">
        {/* Continuously moving content needs a way to stop it that does not
            depend on hovering, so there is an explicit control. */}
        <button
          type="button"
          className="marquee-toggle"
          aria-label={running ? 'Pause' : 'Play'}
          onClick={() => setRunning((value) => !value)}
        >
          {running ? '❙❙' : '▶'}
        </button>
        <p>
          Any capacity figure here comes from a measured benchmark run, never
          from however many agents happen to be running right now.
        </p>
      </div>
    </section>
  );
}
