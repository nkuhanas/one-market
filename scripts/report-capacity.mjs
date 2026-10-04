import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';

const csv = (values) => values.map((v) => JSON.stringify(String(v))).join(',');
function hostStats(directory, repeat) {
  const beforePath = path.join(directory, `host-${repeat}-before.prom`);
  const afterPath = path.join(directory, `host-${repeat}-after.prom`);
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath))
    return ['', '', '', ''];
  const before = fs.readFileSync(beforePath, 'utf8').split('\n');
  const after = fs.readFileSync(afterPath, 'utf8').split('\n');
  const value = (lines, name, type = undefined) => {
    const line = lines.find(
      (l) =>
        l.startsWith(`${name}{`) &&
        (name.includes('memory') || l.includes('reducer="simulation_tick"')) &&
        (!type || l.includes(`txn_type="${type}"`)),
    );
    return line ? Number(line.slice(line.lastIndexOf(' ') + 1)) : 0;
  };
  const delta = (name, type) =>
    value(after, name, type) - value(before, name, type);
  const n = delta('spacetime_txn_elapsed_time_sec_count', 'Reducer');
  if (n <= 0) return ['', '', '', ''];
  return [
    (1000 * delta('spacetime_txn_elapsed_time_sec_sum', 'Reducer')) / n,
    delta('reducer_wasm_time_usec') / n / 1000,
    (1000 * delta('spacetime_txn_elapsed_time_sec_sum', 'Update')) / n,
    value(after, 'spacetime_worker_wasm_memory_bytes'),
  ];
}
for (const input of process.argv.slice(2)) {
  if (input.endsWith('.jsonl')) {
    const groups = new Map();
    for (const line of fs.readFileSync(input, 'utf8').trim().split('\n')) {
      const row = JSON.parse(line);
      const match = row.message?.match(
        /Timing span "(profile\/[^"]+)": ([\d.]+)(ns|µs|ms|s)$/,
      );
      if (!match) continue;
      const ms =
        Number(match[2]) *
        { ns: 0.000001, µs: 0.001, ms: 1, s: 1000 }[match[3]];
      if (!groups.has(match[1])) groups.set(match[1], []);
      groups.get(match[1]).push(ms);
    }
    const rows = ['phase,samples,mean_ms,p99_ms,max_ms'];
    for (const [phase, times] of groups) {
      times.sort((a, b) => a - b);
      rows.push(
        csv([
          phase,
          times.length,
          times.reduce((a, b) => a + b) / times.length,
          times[Math.ceil(times.length * 0.99) - 1],
          times.at(-1),
        ]),
      );
    }
    const result = `${rows.join('\n')}\n`;
    fs.writeFileSync(
      path.join(path.dirname(input), 'tick-profile.csv'),
      result,
    );
    console.log(result);
    continue;
  }
  const files = fs
    .readdirSync(input, { recursive: true })
    .filter((f) => /(?:normal|chaos)-\d+\.json$/.test(f));
  const rows = [
    'artifact,population,profile,run,status,p99_us,skips,updates_per_sec,orders_per_sec,fills_per_sec,initialization_ms,reason,build_hash,configuration_hash,mean_txn_ms,mean_wasm_ms,mean_update_ms,wasm_memory_bytes',
  ];
  for (const file of files.sort()) {
    const a = JSON.parse(fs.readFileSync(path.join(input, file), 'utf8'));
    const m = a.exploratory_metrics;
    if (!m) continue;
    rows.push(
      csv([
        file,
        a.population,
        a.profile,
        a.run_id,
        a.validation.status,
        a.validation.start_lateness_p99_us,
        a.validation.skipped_slots,
        m.actor_updates_per_second,
        m.submitted_orders_per_second,
        m.filled_orders_per_second,
        a.initialization_us / 1000,
        a.validation.reasons.join('; '),
        a.build_hash,
        a.configuration_hash,
        ...hostStats(
          path.dirname(path.join(input, file)),
          file.match(/-(\d+)\.json$/)[1],
        ),
      ]),
    );
  }
  const result = `${rows.join('\n')}\n`;
  fs.writeFileSync(path.join(input, 'capacity.csv'), result);
  console.log(result);
}
