import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

test('production CLI controls require action confirmation before reading credentials or networking', () => {
  for (const [action, confirmation] of [
    ['resume', 'resume'],
    ['pause', 'pause'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./maincloud.mjs', import.meta.url)), action],
      {
        env: { ...env, CONFIRM_MAINCLOUD: 'wrong-action' },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), `Set CONFIRM_MAINCLOUD=${confirmation}`);
  }
});

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
        if (options.body.includes('timed_run_stop')) return result([]);
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

// Exercise operational controls through their real HTTP/SQL boundary. No test
// targets Maincloud or needs credentials, and reducer allowlists catch resets.
function controlWorld(overrides = {}) {
  const state = {
    ...runtime,
    run_id: 8n,
    enabled: false,
    tick: 15090n,
    schedules: 0,
    stops: 0,
    advances: true,
    pauseWorks: true,
    identity: owner,
    ...overrides,
  };
  const mutations = [];
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
      if (options.method === 'GET') return metadata(state.identity);
      if (url.endsWith('/sql')) {
        switch (options.body) {
          case 'SELECT * FROM runtime_config':
            return result([state]);
          case 'SELECT * FROM market_state':
            if (state.enabled && state.advances) state.tick++;
            return result([{ logical_tick: state.tick }]);
          case 'SELECT * FROM run_record':
            return result([{ run_id: state.run_id, status: 'FAILED' }]);
          case 'SELECT * FROM tick_schedule':
            return result(
              Array.from({ length: state.schedules }, (_, i) => ({
                scheduled_id: i + 1,
              })),
            );
          case 'SELECT * FROM timed_run_stop':
            return result(
              Array.from({ length: state.stops }, (_, i) => ({
                scheduled_id: i + 1,
              })),
            );
          default:
            throw new Error('Unexpected query');
        }
      }
      const reducer = url.split('/').at(-1);
      mutations.push(reducer);
      assert.equal(options.body, '[]');
      if (reducer === 'recover_simulation') {
        state.enabled = true;
        state.schedules = 1;
      } else if (reducer === 'pause_simulation') {
        if (state.pauseWorks) {
          state.enabled = false;
          state.schedules = 0;
          state.stops = 0;
        }
      } else throw new Error(`Unexpected mutation: ${reducer}`);
      return new Response('');
    },
    async () => {},
  );
  return { cloud, mutations, state };
}

test('production start resumes once, verifies progress and preserves failed evidence', async () => {
  const { cloud, mutations } = controlWorld();
  const started = await cloud.resume();
  assert.equal(started.tick_progress_verified, true);
  assert.equal(started.run_id, 8n);
  assert.equal(started.run_status, 'FAILED');
  assert.equal(started.initialized, 1000n);
  assert.equal(started.scheduled_ticks, 1);
  await cloud.resume();
  assert.deepEqual(mutations, ['recover_simulation']);
});

test('starting an already running timed session does not cancel its stop', async () => {
  const { cloud, mutations } = controlWorld({
    enabled: true,
    schedules: 1,
    stops: 1,
  });
  assert.equal((await cloud.resume()).scheduled_stops, 1);
  assert.deepEqual(mutations, []);
});

test('production start refuses fresh, incomplete or inconsistent worlds without mutations', async () => {
  for (const overrides of [
    { run_id: 0n },
    { phase: 'INITIALIZING' },
    { initialized: 0n },
    { initialized: 500n },
    { schedules: 1 },
    { stops: 1 },
    { enabled: true, schedules: 0 },
    { enabled: true, schedules: 2 },
  ]) {
    const { cloud, mutations } = controlWorld(overrides);
    await assert.rejects(cloud.resume());
    assert.deepEqual(mutations, []);
  }
});

test('production start reports stalled execution instead of repeated recovery', async () => {
  const { cloud, mutations } = controlWorld({ advances: false });
  await assert.rejects(cloud.resume(), /tick progress was not verified/);
  assert.deepEqual(mutations, ['recover_simulation']);
});

test('production stop clears schedules and verifies a stable server tick; repeated stop is read-only', async () => {
  const { cloud, mutations } = controlWorld({
    enabled: true,
    schedules: 1,
    stops: 1,
  });
  const stopped = await cloud.pause();
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.scheduled_ticks, 0);
  assert.equal(stopped.scheduled_stops, 0);
  assert.equal(stopped.tick_stable_verified, true);
  assert.equal((await cloud.pause()).logical_tick, stopped.logical_tick);
  assert.deepEqual(mutations, ['pause_simulation']);
});

test('production stop surfaces an unsuccessful pause', async () => {
  const { cloud, mutations } = controlWorld({
    enabled: true,
    schedules: 1,
    pauseWorks: false,
  });
  await assert.rejects(cloud.pause(), /schedules remain/);
  assert.deepEqual(mutations, ['pause_simulation']);
});

test('production controls reject a non-owner before any mutation', async () => {
  const { cloud, mutations } = controlWorld({ identity: '00'.repeat(32) });
  await assert.rejects(cloud.resume(), /not the selected database owner/);
  await assert.rejects(cloud.pause(), /not the selected database owner/);
  assert.deepEqual(mutations, []);
});
