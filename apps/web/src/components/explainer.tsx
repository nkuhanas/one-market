import { useEffect, useRef, useState } from 'react';
import { TARGET_HZ } from '../market/contract';

const SLIDES = [
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

/** How long each slide holds before the next one arrives. */
const DWELL_MS = 5200;

export function Explainer() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);

  const go = (next: number) => setIndex((next + SLIDES.length) % SLIDES.length);

  // Pointer and keyboard focus both hold the carousel, and so does leaving the
  // tab, so it never advances while someone is reading it or not looking.
  const paused = !playing || held;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      setIndex((current) => (current + 1) % SLIDES.length);
    }, DWELL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="explain" id="how">
      <div className="explain-head" data-reveal>
        <h2>How it works</h2>
        <p>
          A market anyone can read, run by agents at {TARGET_HZ} ticks a second.
        </p>
      </div>

      <div
        className="carousel"
        role="group"
        aria-roledescription="carousel"
        aria-label="How it works"
        data-reveal
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocusCapture={() => setHeld(true)}
        onBlurCapture={() => setHeld(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') go(index - 1);
          if (event.key === 'ArrowRight') go(index + 1);
        }}
      >
        <button
          type="button"
          className="carousel-arrow"
          aria-label="Previous"
          onClick={() => go(index - 1)}
        >
          ‹
        </button>

        <div className="carousel-window">
          <ol
            className="carousel-track"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {SLIDES.map((slide, i) => (
              <li
                key={slide.title}
                aria-hidden={i !== index}
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${SLIDES.length}`}
              >
                <span className="carousel-index mono">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3>{slide.title}</h3>
                <p>{slide.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <button
          type="button"
          className="carousel-arrow"
          aria-label="Next"
          onClick={() => go(index + 1)}
        >
          ›
        </button>
      </div>

      <div className="carousel-controls">
        <div
          className="carousel-dots"
          role="tablist"
          aria-label="Choose a step"
        >
          {SLIDES.map((slide, i) => (
            <button
              key={slide.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={slide.title}
              className={i === index ? 'dot dot-on' : 'dot'}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
        {/* Auto-advancing content needs a way to stop it that does not depend on
            hovering, so keyboard and touch users get an explicit control. */}
        <button
          type="button"
          className="carousel-play"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? '❙❙' : '▶'}
        </button>
      </div>

      <p className="explain-foot" data-reveal>
        Any capacity figure here comes from a measured benchmark run, never from
        however many agents happen to be running right now.
      </p>
    </section>
  );
}
