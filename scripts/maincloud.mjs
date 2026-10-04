import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(
  readFileSync(new URL('../config/v02.json', import.meta.url), 'utf8'),
);
const normalizeIdentity = (value) =>
  (typeof value === 'string' ? value : value?.__identity__)
    ?.replace(/^0x/, '')
    .toLowerCase();

export function settings(env) {
  if (env.MAINCLOUD_SERVER !== 'https://maincloud.spacetimedb.com')
    throw new Error('Set MAINCLOUD_SERVER=https://maincloud.spacetimedb.com');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(env.MAINCLOUD_DATABASE ?? ''))
    throw new Error('Set an explicit valid MAINCLOUD_DATABASE name');
  const mode = env.MAINCLOUD_PUBLISH_MODE ?? 'fresh';
  if (!['fresh', 'update'].includes(mode))
    throw new Error('MAINCLOUD_PUBLISH_MODE must be fresh or update');
  return {
    server: env.MAINCLOUD_SERVER,
    database: env.MAINCLOUD_DATABASE,
    mode,
  };
}

export function populationSettings(env) {
  if (!/^\d+$/.test(env.POPULATION ?? ''))
    throw new Error('Set an explicit integer POPULATION');
  const population = BigInt(env.POPULATION);
  const seedText = env.SEED ?? String(config.seed);
  if (!/^\d+$/.test(seedText))
    throw new Error('SEED must be an unsigned integer');
  const seed = BigInt(seedText);
  if (population < 1n || population > BigInt(config.population_max))
    throw new Error('POPULATION outside configured bounds');
  if (seed > 18446744073709551615n) throw new Error('SEED exceeds u64');
  return { population, seed };
}

export function setupAction(runtime, market, population, seed) {
  if (runtime.phase === 'EMPTY' && !runtime.enabled && runtime.run_id === 0n)
    return 'configure';
  if (runtime.target_population !== population || runtime.seed !== seed)
    throw new Error(
      'Existing population/seed differs; refusing reset or resize',
    );
  if (
    runtime.phase === 'INITIALIZING' &&
    !runtime.enabled &&
    runtime.run_id === 0n
  )
    return 'initialize';
  if (runtime.phase !== 'READY' || runtime.initialized !== population)
    throw new Error('World is not ready; refusing implicit reset or repair');
  if (runtime.run_id !== 0n) {
    if (!runtime.enabled)
      throw new Error(
        'Existing run is paused/stalled; explicit recovery required',
      );
    return 'running';
  }
  if (runtime.enabled || market.logical_tick !== 0n)
    throw new Error('Start requires a fresh initialized world');
  return 'start';
}

export class Cloud {
  constructor(
    target,
    token,
    request = fetch,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!token)
      throw new Error(
        'Authenticate the Docker CLI or supply SPACETIMEDB_TOKEN',
      );
    this.target = target;
    this.token = token;
    this.request = request;
    this.wait = wait;
    this.endpoint = `${target.server}/v1/database/${target.database}`;
  }

  async http(path = '', body, anonymous = false) {
    const response = await this.request(this.endpoint + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(anonymous ? {} : { Authorization: `Bearer ${this.token}` }),
        'Content-Type': path === '/sql' ? 'text/plain' : 'application/json',
      },
      ...(body === undefined ? {} : { body }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    return { response, text };
  }

  async checked(path, body) {
    const result = await this.http(path, body);
    if (!result.response.ok)
      throw new Error(
        `Maincloud ${path}: HTTP ${result.response.status}: ${result.text.replaceAll(this.token, '[redacted]').slice(0, 400)}`,
      );
    return result.text;
  }

  async metadata() {
    const { response, text } = await this.http();
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        `Maincloud authentication/lookup failed (${response.status})`,
      );
    const metadata = JSON.parse(text);
    const identity = normalizeIdentity(
      response.headers.get('spacetime-identity'),
    );
    if (!identity || identity !== normalizeIdentity(metadata.owner_identity))
      throw new Error(
        'Authenticated identity is not the selected database owner',
      );
    return metadata;
  }

  async preflight() {
    const metadata = await this.metadata();
    if (this.target.mode === 'fresh' && metadata)
      throw new Error(
        'Fresh database name already exists; refusing to overwrite it',
      );
    if (this.target.mode === 'update') {
      if (!metadata) throw new Error('Update target does not exist');
      await this.snapshot(); // Refuse a placeholder or unrelated module.
    }
    return {
      database: this.target.database,
      mode: this.target.mode,
      ready_to_publish: true,
    };
  }

  async query(sql) {
    const result = JSON.parse(
      await this.checked('/sql', sql),
      (_key, value, context) =>
        typeof value === 'number' ? BigInt(context.source) : value,
    )[0];
    return result.rows.map((row) =>
      Object.fromEntries(
        result.schema.elements.map((field, i) => [field.name.some, row[i]]),
      ),
    );
  }

  async snapshot() {
    const runtime = (await this.query('SELECT * FROM runtime_config'))[0];
    const market = (await this.query('SELECT * FROM market_state'))[0];
    if (!runtime || !market) throw new Error('Market bootstrap rows missing');
    return { runtime, market };
  }

  async call(reducer, args = []) {
    // Numeric arguments are validated BigInts; do not narrow u64 seeds in JS.
    const body = `[${args.map((x) => (typeof x === 'bigint' ? x.toString() : JSON.stringify(x))).join(',')}]`;
    await this.checked(`/call/${reducer}`, body);
  }

  async start(population, seed, buildHash, progress = console.error) {
    if (!/^[a-f0-9]{64}$/.test(buildHash))
      throw new Error('Invalid WASM SHA-256');
    const metadata = await this.metadata();
    if (!metadata) throw new Error('Publish the fresh module first');
    if (!Object.hasOwn(metadata.host_type, 'Wasm'))
      throw new Error('Expected the Rust WASM module, not a placeholder');
    let state = await this.snapshot();
    let action = setupAction(state.runtime, state.market, population, seed);
    if (action === 'configure') {
      await this.call('set_actor_population', [population, seed]);
      state = await this.snapshot();
      action = setupAction(state.runtime, state.market, population, seed);
    }
    while (action === 'initialize') {
      const before = state.runtime.initialized;
      await this.call('initialize_batch', [BigInt(config.setup_batch_max)]);
      state = await this.snapshot();
      if (state.runtime.initialized <= before)
        throw new Error('Initialization made no progress; refusing to loop');
      if (
        state.runtime.initialized % 10_000n === 0n ||
        state.runtime.phase === 'READY'
      )
        progress(
          `Initialized ${state.runtime.initialized}/${population} actors`,
        );
      action = setupAction(state.runtime, state.market, population, seed);
    }
    if (action === 'start')
      await this.call('start_run', ['NORMAL', buildHash, false]);
    const run = (await this.query('SELECT * FROM run_record')).find(
      (r) =>
        r.run_id ===
        (action === 'start' ? state.runtime.next_run_id : state.runtime.run_id),
    );
    if (
      !run ||
      run.profile !== 'NORMAL' ||
      run.qualification ||
      run.build_hash !== buildHash
    )
      throw new Error(
        'Existing run does not match this non-qualifying NORMAL build',
      );
    const before = state.market.logical_tick;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const result = await this.status();
      if (
        result.logical_tick > before &&
        result.enabled &&
        result.scheduled_ticks === 1
      )
        return { ...result, tick_progress_verified: true };
    }
    throw new Error(
      'No advancing single-schedule simulation observed; no automatic recovery attempted',
    );
  }

  async status() {
    const metadata = await this.metadata();
    if (!metadata) throw new Error('Database does not exist');
    const { runtime: r, market: m } = await this.snapshot();
    const run = (await this.query('SELECT * FROM run_record')).find(
      (run) => run.run_id === r.run_id,
    );
    const schedules = await this.query('SELECT * FROM tick_schedule');
    const stops = await this.query('SELECT * FROM timed_run_stop');
    return {
      database: this.target.database,
      database_identity: normalizeIdentity(metadata.database_identity),
      host_type: metadata.host_type,
      phase: r.phase,
      initialized: r.initialized,
      target_population: r.target_population,
      seed: r.seed,
      enabled: r.enabled,
      scheduled_ticks: schedules.length,
      scheduled_stops: stops.length,
      logical_tick: m.logical_tick,
      active_actors: m.active_actor_count,
      price_cents: m.price_cents,
      matched_shares: m.matched_share_volume,
      run_id: r.run_id,
      run_status: run?.status ?? null,
      failure_reason: run?.failure_reason ?? null,
      skipped_slots: run?.skipped_slots ?? 0n,
      qualification: run?.qualification ?? false,
      build_hash: run?.build_hash ?? null,
      configuration_hash: m.configuration_hash,
      run_configuration_hash: run?.configuration_hash ?? null,
    };
  }

  async resume() {
    const before = await this.status(); // Includes owner and bootstrap checks.
    if (
      before.phase !== 'READY' ||
      before.initialized === 0n ||
      before.initialized !== before.target_population ||
      before.run_id === 0n
    )
      throw new Error(
        'Resume requires an existing fully initialized run; no setup or reset attempted',
      );
    if (before.enabled) {
      if (before.scheduled_ticks !== 1)
        throw new Error(
          'Running world has an unexpected schedule; refusing automatic repair',
        );
      // Do not restart a running world or cancel an existing timed stop.
    } else {
      if (before.scheduled_ticks !== 0 || before.scheduled_stops !== 0)
        throw new Error(
          'Paused world has leftover schedules; refusing automatic repair',
        );
      await this.call('recover_simulation');
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      await this.wait(1000);
      const result = await this.status();
      if (!result.enabled)
        throw new Error(
          'Simulation stopped during start verification; no retry attempted',
        );
      if (
        result.logical_tick > before.logical_tick &&
        result.scheduled_ticks === 1
      )
        return { ...result, tick_progress_verified: true };
    }
    throw new Error(
      'Start was requested but tick progress was not verified; inspect status or run stop-prod',
    );
  }

  async pause() {
    const before = await this.status();
    if (
      before.enabled ||
      before.scheduled_ticks !== 0 ||
      before.scheduled_stops !== 0
    )
      await this.call('pause_simulation');
    const stopped = await this.status();
    const isPaused = (state) =>
      !state.enabled &&
      state.scheduled_ticks === 0 &&
      state.scheduled_stops === 0;
    if (!isPaused(stopped))
      throw new Error(
        'Pause was requested but schedules remain; inspect maincloud-status',
      );
    // Read the server after the reducer commits, not an in-flight client cache.
    await this.wait(1000);
    const verified = await this.status();
    if (!isPaused(verified) || verified.logical_tick !== stopped.logical_tick)
      throw new Error(
        'A stable paused tick could not be verified; inspect maincloud-status',
      );
    return { ...verified, tick_stable_verified: true };
  }
}

async function main() {
  const target = settings(process.env);
  const action = process.argv[2];
  const confirmations = {
    preflight: 'publish',
    start: 'start',
    resume: 'resume',
    pause: 'pause',
  };
  if (!['preflight', 'start', 'resume', 'status', 'pause'].includes(action))
    throw new Error('Choose preflight, start, resume, status or pause');
  if (
    confirmations[action] &&
    process.env.CONFIRM_MAINCLOUD !== confirmations[action]
  )
    throw new Error(`Set CONFIRM_MAINCLOUD=${confirmations[action]}`);
  const token =
    process.env.SPACETIMEDB_TOKEN ||
    readFileSync('/state/config/cli.toml', 'utf8').match(
      /^spacetimedb_token\s*=\s*"([^"]+)"/m,
    )?.[1];
  const cloud = new Cloud(target, token);
  let result;
  if (action === 'preflight') result = await cloud.preflight();
  else if (action === 'start') {
    const { population, seed } = populationSettings(process.env);
    const hash = createHash('sha256')
      .update(
        readFileSync(
          'target/wasm32-unknown-unknown/release/one_market_spacetime.wasm',
        ),
      )
      .digest('hex');
    result = await cloud.start(population, seed, hash);
  } else if (action === 'resume') result = await cloud.resume();
  else if (action === 'pause') result = await cloud.pause();
  else result = await cloud.status();
  console.log(
    JSON.stringify(
      result,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
