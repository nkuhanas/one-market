// Disposable local old-WASM -> new-WASM preservation gate, never Maincloud.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Cloud } from './maincloud.mjs';

const database = process.env.UPGRADE_DATABASE;
if (!/^one-market-upgrade-test-\d+-\d+$/.test(database ?? ''))
  throw new Error('A uniquely named local upgrade test database is required');
const token = readFileSync('/state/config/cli.toml', 'utf8').match(
  /^spacetimedb_token\s*=\s*"([^"]+)"/m,
)?.[1];
const cloud = new Cloud({ server: 'http://db:3000', database }, token);
const encode = (value) =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const tables = [
  'actor_state',
  'market_state',
  'runtime_config',
  'run_record',
  'grant_accounting',
  'bucket_manifest',
  'human_trader',
  'pending_human_order',
  'order_watermark',
  'price_point',
  'public_activity',
  'actor_sample',
  'human_order_receipt',
  'detailed_benchmark_receipts',
  'news_event',
  'admin_allowlist',
  'benchmark_reader',
  'benchmark_result',
  'validated_run',
  'tick_schedule',
];
async function fingerprints(names = tables) {
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const rows = (await cloud.query(`SELECT * FROM ${name}`))
          .map(encode)
          .sort();
        return [
          name,
          {
            rows: rows.length,
            sha256: createHash('sha256').update(rows.join('\n')).digest('hex'),
          },
        ];
      }),
    ),
  );
}
async function advancing(before) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const state = await cloud.snapshot();
    if (state.market.logical_tick > before) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Local upgrade world did not advance');
}

const phase = process.argv[2];
if (phase === 'prepare') {
  assert.equal((await cloud.metadata()) !== null, true);
  await cloud.call('set_actor_population', [200n, 20261003n]);
  await cloud.call('initialize_batch', [200n]);
  const build = createHash('sha256')
    .update(
      readFileSync('artifacts/builds/market-recovery/market-recovery.wasm'),
    )
    .digest('hex');
  await cloud.call('start_run', ['NORMAL', build, false]);
  await advancing(4n);
  await cloud.call('pause_simulation');
  await cloud.call('enter_market');
  await cloud.call('place_order', [1n, 'BUY', 1n, 10000n]);
  console.log(encode(await fingerprints()));
} else if (phase === 'adopt') {
  assert.deepEqual(
    await fingerprints(),
    JSON.parse(process.env.UPGRADE_BEFORE),
  );
  assert.equal((await cloud.query('SELECT * FROM market_dynamics')).length, 0);
  assert.equal((await cloud.query('SELECT * FROM cadence_state')).length, 0);
  assert.equal(
    (await cloud.query('SELECT * FROM actor_state_compact')).length,
    0,
  );
  const before = await cloud.snapshot();
  const run = (await cloud.query('SELECT * FROM run_record'))[0];
  await cloud.call('benchmark_step'); // The version fence must fire before actor writes.
  assert.equal(
    (await cloud.snapshot()).market.logical_tick,
    before.market.logical_tick,
  );
  assert.deepEqual(
    (await fingerprints(['actor_state'])).actor_state,
    JSON.parse(process.env.UPGRADE_BEFORE).actor_state,
  );
  assert.equal((await cloud.query('SELECT * FROM tick_schedule')).length, 0);
  await cloud.call('recover_simulation');
  await advancing(before.market.logical_tick);
  await cloud.call('pause_simulation');
  const after = await cloud.snapshot();
  const adopted = (await cloud.query('SELECT * FROM run_record'))[0];
  assert.equal(after.market.actor_count, 200n);
  assert.notEqual(
    after.market.configuration_hash,
    before.market.configuration_hash,
  );
  assert.equal(adopted.build_hash, run.build_hash);
  assert.equal(adopted.configuration_hash, run.configuration_hash);
  assert.equal(adopted.status, 'FAILED');
  assert.ok(adopted.failure_reason.includes(run.failure_reason));
  assert.ok(
    adopted.failure_reason.includes(
      'authorized non-qualifying recovery after workload change',
    ),
  );
  assert.equal((await cloud.query('SELECT * FROM market_dynamics')).length, 1);
  assert.equal((await cloud.query('SELECT * FROM bucket_health')).length, 20);
  assert.equal(
    (await cloud.query('SELECT * FROM cadence_state'))[0].profile,
    '20hz',
  );
  const people = [
    ...(await cloud.query('SELECT * FROM actor_state')),
    ...(await cloud.query('SELECT * FROM human_trader')),
  ];
  const accounting = (await cloud.query('SELECT * FROM grant_accounting'))[0];
  assert.equal(
    people.reduce((sum, a) => sum + a.shares, 0n),
    accounting.initial_share_supply,
  );
  assert.equal(
    people.reduce((sum, a) => sum + a.cash_cents, 0n),
    accounting.actor_initial_cash_cents +
      accounting.human_entry_cash_cents +
      accounting.recapitalization_cash_cents,
  );
  const accountsBeforeSwitch = await fingerprints([
    'actor_state',
    'human_trader',
    'pending_human_order',
    'grant_accounting',
    'market_dynamics',
    'bucket_health',
    'actor_recovery',
  ]);
  await cloud.call('set_cadence_profile', ['10hz']);
  assert.deepEqual(
    await fingerprints(Object.keys(accountsBeforeSwitch)),
    accountsBeforeSwitch,
  );
  assert.equal(
    (await cloud.snapshot()).market.logical_tick,
    after.market.logical_tick,
  );
  const newBuild = createHash('sha256')
    .update(
      readFileSync(
        'target/wasm32-unknown-unknown/release/one_market_spacetime.wasm',
      ),
    )
    .digest('hex');
  await cloud.call('start_run', ['NORMAL', newBuild, false]);
  await advancing(after.market.logical_tick + 20n);
  await cloud.call('pause_simulation');
  assert.equal(
    (await cloud.query('SELECT * FROM cadence_state'))[0].profile,
    '10hz',
  );
  // All columns of every actor and all other tables must survive a partial
  // migration plus its inverse; publication above did not move any actors.
  const storageTables = [
    ...tables,
    'actor_state_compact',
    'market_dynamics',
    'bucket_health',
    'actor_recovery',
    'cadence_state',
    'run_cadence',
    'timed_run_stop',
  ];
  const beforeStorage = await fingerprints(storageTables);
  await cloud.call('migrate_actor_storage_batch', [1n, 100n, true]);
  assert.equal((await cloud.query('SELECT * FROM actor_state')).length, 100);
  assert.equal(
    (await cloud.query('SELECT * FROM actor_state_compact')).length,
    100,
  );
  await cloud.call('migrate_actor_storage_batch', [1n, 200n, false]);
  assert.deepEqual(await fingerprints(storageTables), beforeStorage);
  await cloud.call('migrate_actor_storage_batch', [1n, 200n, true]);
  await cloud.call('migrate_actor_storage_batch', [1n, 200n, true]);
  assert.equal((await cloud.query('SELECT * FROM actor_state')).length, 0);
  assert.equal(
    (await cloud.query('SELECT * FROM actor_state_compact')).length,
    200,
  );
  console.log(
    encode(
      await fingerprints([
        ...tables,
        'actor_state_compact',
        'market_dynamics',
        'bucket_health',
        'actor_recovery',
        'cadence_state',
        'run_cadence',
      ]),
    ),
  );
} else if (phase === 'restart') {
  assert.deepEqual(
    await fingerprints([
      ...tables,
      'actor_state_compact',
      'market_dynamics',
      'bucket_health',
      'actor_recovery',
      'cadence_state',
      'run_cadence',
    ]),
    JSON.parse(process.env.UPGRADE_BEFORE),
  );
  const before = await cloud.snapshot();
  await cloud.call('recover_simulation');
  await advancing(before.market.logical_tick);
  await cloud.call('pause_simulation');
  const after = await cloud.snapshot();
  assert.equal(after.runtime.run_id, before.runtime.run_id);
  const run = (await cloud.query('SELECT * FROM run_record')).find(
    (r) => r.run_id === after.runtime.run_id,
  );
  const cadence = (await cloud.query('SELECT * FROM run_cadence')).find(
    (r) => r.run_id === run.run_id,
  );
  assert.equal(cadence.tick_interval_us, 100000n);
  for (const receipt of await cloud.query(
    `SELECT * FROM detailed_benchmark_receipts WHERE run_id = ${run.run_id}`,
  )) {
    assert.equal(
      receipt.intended_at[0],
      run.origin[0] + receipt.intended_slot * cadence.tick_interval_us,
    );
  }
  console.log(
    'Old-world rows, explicit adoption, accounting, reversible compact migration, 20→10 Hz switch, segment evidence and compact-row restart/republish/recovery persistence verified.',
  );
} else if (phase === 'timed-prepare') {
  await cloud.call('set_cadence_profile', ['5hz']);
  const hash = createHash('sha256')
    .update(
      readFileSync(
        'target/wasm32-unknown-unknown/release/one_market_spacetime.wasm',
      ),
    )
    .digest('hex');
  await cloud.call('start_timed_run', ['NORMAL', hash, 20n]);
  const [stop] = await cloud.query('SELECT * FROM timed_run_stop');
  assert.ok(stop);
  assert.equal((await cloud.snapshot()).runtime.enabled, true);
  console.log(encode(stop));
} else if (phase === 'timed-restart') {
  const expected = JSON.parse(process.env.UPGRADE_TIMED);
  const until = performance.now() + 30_000;
  for (;;) {
    const { runtime: r } = await cloud.snapshot();
    assert.equal(r.run_id.toString(), expected.run_id);
    const stops = await cloud.query('SELECT * FROM timed_run_stop');
    if (!r.enabled) {
      assert.equal(stops.length, 0);
      assert.equal(
        (await cloud.query('SELECT * FROM tick_schedule')).length,
        0,
      );
      break;
    }
    // It may expire between these separate reads; any surviving timer must
    // retain its original deadline across recreation and publication.
    if (stops.length) assert.equal(encode(stops[0]), encode(expected));
    assert.ok(
      performance.now() < until,
      'persisted stop did not pause the world',
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const receipts = await cloud.query(
    `SELECT * FROM detailed_benchmark_receipts WHERE run_id = ${BigInt(expected.run_id)}`,
  );
  assert.ok(receipts.length > 0);
  for (const receipt of receipts) {
    assert.ok(receipt.invoked_at[0] < BigInt(expected.deadline[0]));
  }
  const tick = (await cloud.snapshot()).market.logical_tick;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await cloud.snapshot()).market.logical_tick, tick);
  console.log(
    'Persisted 5 Hz timed stop survived server recreation/republish and stopped without an external pause.',
  );
} else if (phase === 'chaos-prepare') {
  const before = await cloud.snapshot();
  assert.equal(before.runtime.enabled, false);
  await cloud.call('trigger_chaos');
  const [expiry] = await cloud.query('SELECT * FROM chaos_expiry');
  assert.ok(expiry);
  assert.equal(expiry.deadline[0] - expiry.started_at[0], 60_000_000n);
  console.log(
    encode({
      expiry,
      tick: before.market.logical_tick,
      accounts: await fingerprints([
        'actor_state',
        'actor_state_compact',
        'human_trader',
        'grant_accounting',
      ]),
    }),
  );
} else if (phase === 'chaos-restart') {
  const expected = JSON.parse(process.env.UPGRADE_CHAOS);
  const until = performance.now() + 65_000;
  for (;;) {
    const snapshot = await cloud.snapshot();
    assert.equal(snapshot.runtime.enabled, false);
    assert.equal(snapshot.market.logical_tick.toString(), expected.tick);
    assert.equal((await cloud.query('SELECT * FROM tick_schedule')).length, 0);
    const timers = await cloud.query('SELECT * FROM chaos_expiry');
    if (!snapshot.market.chaos_active) {
      assert.equal(timers.length, 0);
      assert.equal(snapshot.runtime.chaos_signal_bps, 0n);
      break;
    }
    if (timers.length) assert.equal(encode(timers[0]), encode(expected.expiry));
    assert.ok(
      performance.now() < until,
      'CHAOS deadline did not expire after restart',
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.deepEqual(
    await fingerprints(Object.keys(expected.accounts)),
    expected.accounts,
  );
  console.log(
    'CHAOS kept its original 60-second deadline across restart/republish and expired while paused without changing actor/account state.',
  );
} else {
  throw new Error(
    'Choose prepare, adopt, restart, timed-prepare, timed-restart, chaos-prepare or chaos-restart',
  );
}
