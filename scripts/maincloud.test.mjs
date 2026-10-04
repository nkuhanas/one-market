import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Cloud,
  populationSettings,
  settings,
  setupAction,
} from './maincloud.mjs';

const env = {
  MAINCLOUD_SERVER: 'https://maincloud.spacetimedb.com',
  MAINCLOUD_DATABASE: 'one-market-test-fresh',
};
const owner = 'ab'.repeat(32);
const build = 'cd'.repeat(32);
const runtime = {
  phase: 'READY',
  enabled: false,
  run_id: 0n,
  next_run_id: 1n,
  initialized: 1000n,
  target_population: 1000n,
  seed: 20261003n,
};
const market = { logical_tick: 0n };

test('requires explicit Maincloud target and rejects credential-bearing URLs', () => {
  assert.equal(settings(env).mode, 'fresh');
  assert.throws(() => settings({}), /MAINCLOUD_SERVER/);
  for (const url of [
    'http://maincloud.spacetimedb.com',
    'https://example.com',
    'https://secret@maincloud.spacetimedb.com',
  ])
    assert.throws(() => settings({ ...env, MAINCLOUD_SERVER: url }));
  assert.throws(() => settings({ ...env, MAINCLOUD_DATABASE: '../other' }));
  assert.throws(() => settings({ ...env, MAINCLOUD_PUBLISH_MODE: 'reset' }));
});

test('population and seed are bounded exact integers', () => {
  assert.deepEqual(populationSettings({ POPULATION: '100000' }), {
    population: 100000n,
    seed: 20261003n,
  });
  assert.equal(
    populationSettings({ POPULATION: '100000', SEED: '18446744073709551615' })
      .seed,
    18446744073709551615n,
  );
  for (const population of [undefined, '0', '-1', '1000001', '1.5', '1e5'])
    assert.throws(() => populationSettings({ POPULATION: population }));
  assert.throws(() =>
    populationSettings({ POPULATION: '100000', SEED: '18446744073709551616' }),
  );
});

test('fresh setup and interrupted initialization have separate actions', () => {
  assert.equal(
    setupAction(
      { ...runtime, phase: 'EMPTY', initialized: 0n },
      market,
      1000n,
      runtime.seed,
    ),
    'configure',
  );
  assert.equal(
    setupAction(
      { ...runtime, phase: 'INITIALIZING', initialized: 500n },
      market,
      1000n,
      runtime.seed,
    ),
    'initialize',
  );
  assert.equal(setupAction(runtime, market, 1000n, runtime.seed), 'start');
});

test('existing runs do not get another start or an implicit recovery', () => {
  assert.equal(
    setupAction(
      { ...runtime, run_id: 1n, enabled: true },
      { logical_tick: 5n },
      1000n,
      runtime.seed,
    ),
    'running',
  );
  assert.throws(
    () => setupAction({ ...runtime, run_id: 1n }, market, 1000n, runtime.seed),
    /paused\/stalled/,
  );
  assert.throws(
    () => setupAction(runtime, { logical_tick: 1n }, 1000n, runtime.seed),
    /fresh/,
  );
});

test('population/seed mismatch and incomplete state never trigger reset', () => {
  assert.throws(
    () => setupAction(runtime, market, 2000n, runtime.seed),
    /refusing reset/,
  );
  assert.throws(
    () => setupAction(runtime, market, 1000n, 42n),
    /refusing reset/,
  );
  assert.throws(
    () =>
      setupAction(
        { ...runtime, phase: 'RESETTING' },
        market,
        1000n,
        runtime.seed,
      ),
    /refusing implicit/,
  );
});

const metadata = (identity = owner) =>
  new Response(
    JSON.stringify({
      owner_identity: { __identity__: owner },
      database_identity: { __identity__: 'ef'.repeat(32) },
      host_type: { Wasm: [] },
    }),
    { headers: { 'spacetime-identity': identity } },
  );

test('fresh-name preflight refuses existing databases without a mutation', async () => {
  const calls = [];
  const cloud = new Cloud(
    settings(env),
    'test-secret',
    async (_url, options) => {
      calls.push(options.method);
      return metadata();
    },
  );
  await assert.rejects(cloud.preflight(), /already exists/);
  assert.deepEqual(calls, ['GET']);
});

test('preflight accepts absent names, not permission or server errors', async () => {
  const absent = new Cloud(
    settings(env),
    'test-secret',
    async () => new Response('', { status: 404 }),
  );
  assert.equal((await absent.preflight()).ready_to_publish, true);
  for (const status of [401, 403, 500]) {
    const denied = new Cloud(
      settings(env),
      'test-secret',
      async () => new Response('', { status }),
    );
    await assert.rejects(denied.preflight(), /failed/);
  }
  const wrongOwner = new Cloud(settings(env), 'test-secret', async () =>
    metadata('00'.repeat(32)),
  );
  await assert.rejects(
    wrongOwner.preflight(),
    /not the selected database owner/,
  );
});

test('HTTP errors redact credentials and reducer arguments preserve u64 precision', async () => {
  let body;
  const cloud = new Cloud(
    settings(env),
    'test-secret',
    async (_url, options) => {
      body = options.body;
      return new Response('test-secret is not authorized', { status: 403 });
    },
  );
  await assert.rejects(
    cloud.call('set_actor_population', [100000n, 18446744073709551615n]),
    (error) => {
      assert(!error.message.includes('test-secret'));
      return true;
    },
  );
  assert.equal(body, '[100000,18446744073709551615]');
});

test('resumes only remaining batches, starts once, and leaves a running world unchanged', async () => {
  const state = { ...runtime, phase: 'INITIALIZING', initialized: 500n };
  const m = {
    logical_tick: 0n,
    active_actor_count: 1000n,
    price_cents: 10000n,
    matched_share_volume: 5n,
  };
  let run;
  const calls = [];
  const result = (rows) => {
    const fields = Object.keys(rows[0] ?? {});
    return new Response(
      JSON.stringify(
        [
          {
            schema: {
              elements: fields.map((name) => ({ name: { some: name } })),
            },
            rows: rows.map((row) => fields.map((field) => row[field])),
          },
        ],
        (_key, value) => (typeof value === 'bigint' ? Number(value) : value),
      ),
    );
  };
  const cloud = new Cloud(
    settings(env),
    'test-secret',
    async (url, options) => {
      if (options.method === 'GET') return metadata();
      if (url.endsWith('/sql')) {
        if (options.body.includes('runtime_config')) return result([state]);
        if (options.body.includes('market_state')) {
          if (state.enabled) m.logical_tick++;
          return result([m]);
        }
        if (options.body.includes('run_record'))
          return result(run ? [run] : []);
        if (options.body.includes('tick_schedule'))
          return result(state.enabled ? [{ scheduled_id: 1n }] : []);
        throw new Error('Unexpected query');
      }
      const reducer = url.split('/').at(-1);
      calls.push(reducer);
      if (reducer === 'initialize_batch') {
        assert.equal(options.body, '[500]');
        state.initialized = 1000n;
        state.phase = 'READY';
      } else if (reducer === 'start_run') {
        state.enabled = true;
        state.run_id = 1n;
        run = {
          run_id: 1n,
          profile: 'NORMAL',
          qualification: false,
          build_hash: build,
          status: 'RUNNING',
        };
      } else throw new Error('Unexpected mutation');
      return new Response('');
    },
  );
  const first = await cloud.start(1000n, runtime.seed, build, () => {});
  assert(first.tick_progress_verified);
  assert.equal(first.scheduled_ticks, 1);
  await cloud.start(1000n, runtime.seed, build, () => {});
  assert.deepEqual(calls, ['initialize_batch', 'start_run']);
});
