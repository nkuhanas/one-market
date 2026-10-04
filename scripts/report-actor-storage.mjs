// Read-only comparison of LOCAL exploration artifacts and retained host metrics.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function report(directory) {
  const read = (file) => readFileSync(path.join(directory, file), 'utf8');
  const a = JSON.parse(read('normal-1.json'));
  assert.equal(a.environment, 'LOCAL');
  const before = read('host-1-before.prom').split('\n');
  const after = read('host-1-after.prom').split('\n');
  function metric(lines, name, labels = {}, optional = false) {
    const matches = lines.filter(
      (line) =>
        line.startsWith(`${name}{`) &&
        Object.entries(labels).every(([key, value]) =>
          line.includes(`${key}="${value}"`),
        ),
    );
    if (optional && matches.length === 0) return 0;
    assert.equal(matches.length, 1, `${name}: metric must identify one series`);
    return Number(matches[0].slice(matches[0].lastIndexOf(' ') + 1));
  }
  const delta = (name, labels) =>
    // A fresh world's simulation_tick counter does not exist before its first call.
    metric(after, name, labels) - metric(before, name, labels, true);
  const tick = { reducer: 'simulation_tick', txn_type: 'Reducer' };
  const ticks = delta('spacetime_txn_elapsed_time_sec_count', tick);
  assert.ok(ticks > 0);
  const reducerMs =
    (delta('spacetime_txn_elapsed_time_sec_sum', tick) * 1000) / ticks;
  const wasmMs =
    delta('reducer_wasm_time_usec', { reducer: 'simulation_tick' }) /
    ticks /
    1000;
  const intervals = a.receipts
    .slice(1)
    .map((r, i) => (r.invoked_at_us - a.receipts[i].invoked_at_us) / 1000)
    .sort((x, y) => x - y);
  return {
    directory,
    database: a.database,
    build_hash: a.build_hash,
    configuration_hash: a.configuration_hash,
    population: a.population,
    seed: a.seed,
    cadence: a.cadence_profile,
    viewers: a.subscriber_count,
    offered_orders_per_second: a.offered_orders_per_second,
    warmup_seconds: a.warmup_seconds,
    measurement_seconds: a.measurement_seconds,
    validation: a.validation,
    accounting_audit: a.accounting_audit,
    ticks_in_host_metric_window: ticks,
    mean_reducer_transaction_ms: reducerMs,
    mean_wasm_ms: wasmMs,
    mean_transaction_minus_wasm_ms: reducerMs - wasmMs,
    mean_subscription_update_ms:
      (delta('spacetime_txn_elapsed_time_sec_sum', {
        reducer: 'simulation_tick',
        txn_type: 'Update',
      }) *
        1000) /
      ticks,
    reducer_bytes_scanned_per_tick:
      delta('spacetime_num_bytes_scanned_total', { txn_type: 'Reducer' }) /
      ticks,
    reducer_bytes_written_per_tick:
      delta('spacetime_num_bytes_written_total', { txn_type: 'Reducer' }) /
      ticks,
    sampled_message_log_growth_bytes_per_tick:
      delta('spacetime_message_log_size_bytes') / ticks,
    actor_row_page_bytes: ['actor_state', 'actor_state_compact'].reduce(
      (sum, table_name) =>
        sum +
        metric(
          after,
          'spacetime_data_size_bytes_used_by_rows',
          { table_name },
          true,
        ),
      0,
    ),
    start_interval_mean_ms:
      intervals.reduce((sum, n) => sum + n, 0) / intervals.length,
    start_interval_p99_ms: intervals[Math.ceil(intervals.length * 0.99) - 1],
    start_interval_max_ms: intervals.at(-1),
    market_health: Object.fromEntries(
      Object.entries(a.market_health).filter(([key]) => key !== 'samples'),
    ),
  };
}

const [baselineDirectory, candidateDirectory] = process.argv.slice(2);
assert.ok(
  baselineDirectory && candidateDirectory,
  'usage: node scripts/report-actor-storage.mjs BASELINE_DIR CANDIDATE_DIR',
);
const baseline = report(baselineDirectory);
const candidate = report(candidateDirectory);
for (const field of [
  'population',
  'seed',
  'cadence',
  'viewers',
  'offered_orders_per_second',
  'warmup_seconds',
  'measurement_seconds',
  'configuration_hash',
]) {
  assert.equal(
    candidate[field],
    baseline[field],
    `comparison differs in ${field}`,
  );
}
// Per-tick R/W/log figures include all reducers between host snapshots (warmup
// and measurement), including the identical offered-human-order workload. They
// are host counters, not isolated disk I/O or production latency measurements.
console.log(
  JSON.stringify(
    {
      baseline,
      candidate,
      note: 'LOCAL exploratory comparison, not Maincloud qualification. Host counters include warmup and other reducers; transaction-minus-WASM is not an isolated commit/fsync timer. Message-log gauges can lag and are not exact WAL byte deltas.',
    },
    null,
    2,
  ),
);
