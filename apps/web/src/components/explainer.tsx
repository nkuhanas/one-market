import { TARGET_HZ, TICKS_PER_EPOCH } from '../market/contract';

const STEPS = [
  {
    title: 'One shared world',
    body: 'The market is a single row of authoritative state in SpacetimeDB, not a copy per visitor. Every browser subscribes to the same world, so two windows side by side always agree.',
  },
  {
    title: 'Actors decide for themselves',
    body: 'Each actor holds its own cash, shares and policy weights — momentum, mean reversion, contrarian, news. They are small deterministic policies, not language models, which is what makes a very large population affordable.',
  },
  {
    title: 'One auction per tick',
    body: 'Every tick collects the intents of the actors that are due, plus any human orders, and clears them in a single uniform-price auction. Nothing rests on a book: unfilled orders expire and the price is whatever the crossing produced.',
  },
  {
    title: 'Losses are real',
    body: 'An actor that falls far enough below its own peak is forced to liquidate and sit out before it can be recapitalised. Nobody is propping the price up, so a sell-off with no buyers can freeze the market outright.',
  },
];

export function Explainer() {
  return (
    <section className="explain" id="how">
      <header className="explain-head">
        <h2>How it works</h2>
        <p>
          The market is the readable surface. The experiment underneath is how
          many persistent actors one database can keep stepping at {TARGET_HZ}{' '}
          Hz before it falls behind.
        </p>
      </header>

      <ol className="explain-steps">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="explain-index mono">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="explain-note">
        <h3>About the capacity claim</h3>
        <p>
          Actors are stepped in {TICKS_PER_EPOCH} buckets, so every actor is
          updated once per epoch whether it trades or not. Any capacity figure
          shown on this page comes from a qualified benchmark run under a fixed
          workload — never from however many actors happen to be running right
          now. Until such a run exists, that figure stays empty.
        </p>
      </div>
    </section>
  );
}
