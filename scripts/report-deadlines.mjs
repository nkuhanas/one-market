// Correlate diagnostic process samples with receipt deadlines. A window is
// intentionally wider than one tick: process counters cannot attribute a stall
// to a particular reducer/thread or establish a causal storage bottleneck.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';

const [trace, artifact] = process.argv.slice(2);
if (!trace || !artifact) {
  throw Error(
    'usage: report-deadlines.mjs <trace-directory> <explore-run.json>',
  );
}
const [header, ...lines] = fs
  .readFileSync(path.join(trace, 'process.csv'), 'utf8')
  .trim()
  .split('\n');
const fields = header.split(',');
const samples = lines.map((line) => {
  const values = line.split(',').map(Number);
  if (
    values.length !== fields.length ||
    values.some((v) => !Number.isSafeInteger(v))
  ) {
    throw Error('invalid or imprecise process counter sample');
  }
  return Object.fromEntries(fields.map((field, i) => [field, values[i]]));
});
const run = JSON.parse(fs.readFileSync(artifact, 'utf8'));
if (run.mode !== 'EXPLORE' || samples.length < 2)
  throw Error('diagnostic exploration required');
const counterFields = [
  'minor_faults',
  'major_faults',
  'thread_cpu_ns',
  'thread_runqueue_ns',
  'thread_slices',
  'read_bytes',
  'write_bytes',
];
const columns = [
  'slot',
  'tick',
  'lateness_us',
  'skips',
  'sample_start_us',
  'sample_end_us',
  'threads_before',
  'threads_after',
  'counters_monotonic',
  ...counterFields,
  'rss_pages',
];
const correlations = [];
for (const receipt of run.receipts) {
  const start = receipt.intended_at_us - 50_000;
  const end = receipt.invoked_at_us + 50_000;
  const before = samples.findLast((s) => s.at_us <= start);
  const after = samples.find((s) => s.at_us >= end);
  if (!before || !after) continue; // Never extrapolate beyond captured load.
  const deltas = counterFields.map((key) => after[key] - before[key]);
  correlations.push([
    receipt.intended_slot,
    receipt.logical_tick,
    receipt.start_lateness_us,
    receipt.skipped_slots,
    before.at_us,
    after.at_us,
    before.threads,
    after.threads,
    deltas.every((d) => d >= 0),
    ...deltas,
    after.rss_pages,
  ]);
}
fs.writeFileSync(
  path.join(trace, 'deadline-correlations.csv'),
  [columns, ...correlations].map((row) => row.join(',')).join('\n') + '\n',
);
console.log(
  JSON.stringify(
    {
      artifact,
      build_hash: run.build_hash,
      captured_samples: samples.length,
      correlated_receipts: correlations.length,
      skipped_slots: run.validation.skipped_slots,
      p99_start_lateness_us: run.validation.start_lateness_p99_us,
      columns,
      largest_lateness_windows: [...correlations]
        .sort((a, b) => b[2] - a[2])
        .slice(0, 10),
      limitation:
        'Overlapping ~100ms sampled process-wide windows; correlation is not per-tick causal attribution. Thread churn can invalidate scheduler deltas.',
    },
    null,
    2,
  ),
);
