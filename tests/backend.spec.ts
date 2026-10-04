import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ScheduleAt } from 'spacetimedb';
import { openOrderedWebSocket } from '@one-market/transport';
import { DbConnection } from './private-bindings';
import { actorRows, actorRow } from './helpers/actor-state';
import {
  assertRemainsPaused,
  cachedSnapshot,
  pauseAndSynchronize,
  serverSnapshot,
} from './helpers/paused-state';

const database = process.env.BACKEND_DATABASE!;
if (!database?.startsWith('one-market-v02-test-')) {
  throw new Error(
    'Backend tests require their own freshly published test database',
  );
}
const token = readFileSync('/state/config/cli.toml', 'utf8').match(
  /^spacetimedb_token\s*=\s*"([^"]+)"/m,
)?.[1];
if (!token) throw new Error('Local publishing identity unavailable');
const buildHash = process.env.MODULE_HASH!;
let owner: DbConnection;
let alice: DbConnection;
let bob: DbConnection;

async function connect(auth?: string): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withWSFn(openOrderedWebSocket)
      .withCompression('gzip')
      .withUri(process.env.BACKEND_URI!)
      .withDatabaseName(database)
      .withConfirmedReads(true)
      .withToken(auth)
      .onConnect((connection) => resolve(connection))
      .onConnectError((_ctx, error) => reject(error))
      .build();
  });
}

function subscribe(connection: DbConnection, queries: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    connection
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) =>
        reject(new Error(ctx.event?.message || 'subscription rejected')),
      )
      .subscribe(queries);
  });
}

const row = () => owner.db.marketState.id.find(0)!;
const readServer = () =>
  serverSnapshot(process.env.BACKEND_URI!, database, token);
const readCache = () => cachedSnapshot(owner);
const pause = () =>
  pauseAndSynchronize(
    () => owner.reducers.pauseSimulation({}),
    readServer,
    readCache,
  );

test.describe
  .serial('v0.2 exact-runtime compatibility and transactions', () => {
  test.beforeAll(async () => {
    [owner, alice, bob] = await Promise.all([
      connect(token),
      connect(),
      connect(),
    ]);
    await subscribe(owner, [
      'SELECT * FROM market_state',
      'SELECT * FROM runtime_config',
      'SELECT * FROM actor_state',
      'SELECT * FROM actor_state_compact',
      'SELECT * FROM grant_accounting',
      'SELECT * FROM run_record',
      'SELECT * FROM tick_schedule',
      'SELECT * FROM detailed_benchmark_receipts',
      'SELECT * FROM bucket_manifest',
      'SELECT * FROM market_dynamics',
      'SELECT * FROM bucket_health',
      'SELECT * FROM actor_recovery',
      'SELECT * FROM cadence_state',
      'SELECT * FROM run_cadence',
      'SELECT * FROM timed_run_stop',
      'SELECT * FROM news_event',
      'SELECT * FROM chaos_expiry',
    ]);
    for (const client of [alice, bob]) {
      await subscribe(client, [
        'SELECT * FROM market_state',
        'SELECT * FROM my_trader',
        'SELECT * FROM my_pending_order',
        'SELECT * FROM my_recent_fills',
        'SELECT * FROM benchmark_latest_receipt',
      ]);
    }
  });

  test.afterAll(async () => {
    try {
      if (owner?.isActive) await owner.reducers.pauseSimulation({});
    } finally {
      for (const client of [owner, alice, bob]) client?.disconnect();
    }
  });

  test('bounded resumable setup, no ticks during setup, and authorization', async () => {
    await expect(
      alice.reducers.setActorPopulation({ population: 40n, seed: 20261003n }),
    ).rejects.toThrow();
    await expect(
      alice.reducers.resetMarket({ confirmation: 'RESET WORLD' }),
    ).rejects.toThrow();
    await expect(alice.reducers.triggerChaos({})).rejects.toThrow(
      'world is not ready',
    );
    await expect(alice.reducers.benchmarkStep({})).rejects.toThrow();
    await expect(
      alice.reducers.setCadenceProfile({ profile: '10hz' }),
    ).rejects.toThrow();
    await expect(
      alice.reducers.pruneRunEvidence({
        runId: 1n,
        confirmation: 'PRUNE RUN 1',
      }),
    ).rejects.toThrow();
    await expect(
      alice.reducers.authorizeReader({ identity: alice.identity! }),
    ).rejects.toThrow();
    await owner.reducers.setActorPopulation({
      population: 40n,
      seed: 20261003n,
    });
    await expect(
      owner.reducers.initializeBatch({ count: 501n }),
    ).rejects.toThrow();
    await owner.reducers.initializeBatch({ count: 13n });
    await expect.poll(() => row().actorCount).toBe(13n);
    expect(row().logicalTick).toBe(0n);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    await expect(
      owner.reducers.startRun({
        profile: 'NORMAL',
        buildHash,
        qualification: false,
      }),
    ).rejects.toThrow();
    await owner.reducers.initializeBatch({ count: 27n });
    await expect.poll(() => row().phase).toBe('READY');
    expect(actorRows(owner)).toHaveLength(40);
    expect(owner.db.grantAccounting.id.find(0)!.initialShareSupply).toBe(1000n);
    expect(owner.db.grantAccounting.id.find(0)!.actorInitialCashCents).toBe(
      10000000n,
    );
    expect(owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents).toBe(
      0n,
    );
    for (const actor of actorRows(owner)) {
      expect(actor.cashCents).toBe(250000n);
      expect(actor.shares).toBe(25n);
      expect(actor.markedEquityCents).toBe(500000n);
      expect(actor.initialEndowmentValueCents).toBe(500000n);
      expect(actor.lifePeakEquityCents).toBe(500000n);
      expect(actor.cumulativeRecapitalizationGrantsCents).toBe(0n);
      expect(actor.lifetimePnlCents).toBe(0n);
      expect(actor.wipeoutCount).toBe(0n);
      expect(actor.lastStepTick.present).toBe(false);
      expect(actor.status.tag).toBe('Active');
    }
  });

  test('actor storage migration is authorized, bounded, reversible, and atomic', async () => {
    const original = actorRows(owner);
    expect([...owner.db.actorStateCompact.iter()]).toHaveLength(40);
    expect([...owner.db.actorState.iter()]).toHaveLength(0);
    const unchanged = () => ({
      market: row(),
      runtime: owner.db.runtimeConfig.id.find(0),
      grants: owner.db.grantAccounting.id.find(0),
      manifests: [...owner.db.bucketManifest.iter()],
    });
    const before = unchanged();
    await expect(
      alice.reducers.migrateActorStorageBatch({
        startActorId: 1n,
        count: 1n,
        compact: false,
      }),
    ).rejects.toThrow();
    for (const [startActorId, count] of [
      [0n, 1n],
      [1n, 0n],
      [1n, 501n],
      [40n, 2n],
      [(1n << 64n) - 1n, 2n],
    ]) {
      await expect(
        owner.reducers.migrateActorStorageBatch({
          startActorId,
          count,
          compact: false,
        }),
      ).rejects.toThrow();
    }
    await owner.reducers.migrateActorStorageBatch({
      startActorId: 1n,
      count: 20n,
      compact: false,
    });
    await expect.poll(() => [...owner.db.actorState.iter()].length).toBe(20);
    expect(actorRows(owner)).toEqual(original);
    await owner.reducers.migrateActorStorageBatch({
      startActorId: 1n,
      count: 20n,
      compact: false,
    });
    expect(actorRows(owner)).toEqual(original);
    await owner.reducers.migrateActorStorageBatch({
      startActorId: 1n,
      count: 40n,
      compact: true,
    });
    await expect
      .poll(() => [...owner.db.actorStateCompact.iter()].length)
      .toBe(40);
    expect(actorRows(owner)).toEqual(original);
    // Failure after actor 1 has already moved must roll back that move too.
    await owner.reducers.testActorStorageFixture({
      actorId: 2n,
      mode: 'invalidate_flags',
    });
    await expect
      .poll(() => owner.db.actorStateCompact.actorId.find(2n)!.flags & 128)
      .toBe(128);
    await expect(
      owner.reducers.migrateActorStorageBatch({
        startActorId: 1n,
        count: 40n,
        compact: false,
      }),
    ).rejects.toThrow();
    expect([...owner.db.actorState.iter()]).toHaveLength(0);
    expect([...owner.db.actorStateCompact.iter()]).toHaveLength(40);
    await owner.reducers.testActorStorageFixture({
      actorId: 2n,
      mode: 'repair_flags',
    });
    await expect
      .poll(() => owner.db.actorStateCompact.actorId.find(2n)!.flags & 128)
      .toBe(0);
    expect(actorRows(owner)).toEqual(original);
    expect(unchanged()).toEqual(before);
    // Exercise the following scheduler/settlement tests on both representations.
    await owner.reducers.migrateActorStorageBatch({
      startActorId: 1n,
      count: 20n,
      compact: false,
    });
    await expect.poll(() => [...owner.db.actorState.iter()].length).toBe(20);
  });

  test('caller-scoped views and private tables reject cross-identity reads', async () => {
    await alice.reducers.enterMarket({});
    await bob.reducers.enterMarket({});
    await alice.reducers.enterMarket({});
    await expect.poll(() => [...alice.db.myTrader.iter()].length).toBe(1);
    await expect.poll(() => [...bob.db.myTrader.iter()].length).toBe(1);
    expect([...alice.db.myTrader.iter()][0].identity.toHexString()).toBe(
      alice.identity!.toHexString(),
    );
    expect([...bob.db.myTrader.iter()][0].identity.toHexString()).toBe(
      bob.identity!.toHexString(),
    );
    expect([...alice.db.benchmarkLatestReceipt.iter()]).toHaveLength(0);
    await expect.poll(() => row().registeredHumanTraderCount).toBe(2n);
    for (const client of [alice, bob]) {
      const trader = [...client.db.myTrader.iter()][0];
      expect(trader.cashCents).toBe(10000000n);
      expect(trader.shares).toBe(0n);
      expect(trader.pnlCents).toBe(0n);
    }
    await expect
      .poll(() => owner.db.grantAccounting.id.find(0)!.humanEntryCount)
      .toBe(2n);
    expect(owner.db.grantAccounting.id.find(0)!.humanEntryCashCents).toBe(
      20000000n,
    );
    for (const table of [
      'human_trader',
      'pending_human_order',
      'human_order_receipt',
      'actor_state',
      'actor_state_compact',
      'actor_recovery',
      'run_cadence',
      'timed_run_stop',
      'detailed_benchmark_receipts',
    ]) {
      const outsider = await connect();
      try {
        await expect(
          subscribe(outsider, [`SELECT * FROM ${table}`]),
        ).rejects.toThrow();
      } finally {
        outsider.disconnect();
      }
    }
  });

  test('reservations, durable IDs, limits, and rejected transaction rollback', async () => {
    await alice.reducers.placeOrder({
      clientOrderId: 1n,
      side: 'BUY',
      quantity: 2n,
      limitPriceCents: 10100n,
    });
    await expect.poll(() => [...alice.db.myPendingOrder.iter()].length).toBe(1);
    expect([...bob.db.myPendingOrder.iter()]).toHaveLength(0);
    await expect
      .poll(() => [...alice.db.myTrader.iter()][0].reservedCashCents)
      .toBe(20200n);
    await expect(
      alice.reducers.placeOrder({
        clientOrderId: 1n,
        side: 'BUY',
        quantity: 2n,
        limitPriceCents: 10100n,
      }),
    ).rejects.toThrow();
    await expect(
      alice.reducers.placeOrder({
        clientOrderId: 2n,
        side: 'BUY',
        quantity: 1n,
        limitPriceCents: 10100n,
      }),
    ).rejects.toThrow();
    await expect(
      bob.reducers.placeOrder({
        clientOrderId: 1n,
        side: 'SELL',
        quantity: 1n,
        limitPriceCents: 10000n,
      }),
    ).rejects.toThrow();
    await expect(
      bob.reducers.placeOrder({
        clientOrderId: 1n,
        side: 'BUY',
        quantity: 100n,
        limitPriceCents: 100000000n,
      }),
    ).rejects.toThrow();
    await expect(
      bob.reducers.placeOrder({
        clientOrderId: 1n,
        side: 'BUY',
        quantity: 101n,
        limitPriceCents: 100n,
      }),
    ).rejects.toThrow();
    expect([...bob.db.myTrader.iter()][0].reservedCashCents).toBe(0n);
    // Same new ID remains usable after all rejected attempts.
    await bob.reducers.placeOrder({
      clientOrderId: 1n,
      side: 'BUY',
      quantity: 1n,
      limitPriceCents: 10100n,
    });
  });

  test('absolute scheduler commits coverage and trades; manual calls cannot advance it', async () => {
    await owner.reducers.startRun({
      profile: 'NORMAL',
      buildHash,
      qualification: false,
    });
    await expect(owner.reducers.benchmarkStep({})).rejects.toThrow();
    const scheduled = {
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(0n),
      generation: 1n,
      intendedSlot: 1n,
    };
    await expect(
      alice.reducers.simulationTick({ scheduled }),
    ).rejects.toThrow();
    await expect(
      owner.reducers.simulationTick({ scheduled }),
    ).rejects.toThrow();
    await expect.poll(() => row().logicalTick).toBeGreaterThanOrEqual(40n);
    const receipts = [...owner.db.detailedBenchmarkReceipts.iter()];
    expect(receipts.length).toBeGreaterThanOrEqual(40);
    for (const receipt of receipts) {
      const manifest = owner.db.bucketManifest.bucket.find(receipt.bucket)!;
      expect(receipt.actorSteps).toBe(manifest.actorCount);
      expect(receipt.actorRowsUpdated).toBe(receipt.actorSteps);
      expect(receipt.membershipDigest).toEqual(manifest.membershipDigest);
      expect(receipt.previousStepsValid).toBe(true);
      const run = owner.db.runRecord.runId.find(receipt.runId)!;
      expect(receipt.intendedAt.microsSinceUnixEpoch).toBe(
        run.origin.microsSinceUnixEpoch + receipt.intendedSlot * 50000n,
      );
    }
    await expect.poll(() => [...alice.db.myPendingOrder.iter()].length).toBe(0);
    await expect
      .poll(() => [...alice.db.myTrader.iter()][0].reservedCashCents)
      .toBe(0n);
    expect(
      [...alice.db.myRecentFills.iter()].every((r) =>
        r.identity.isEqual(alice.identity!),
      ),
    ).toBe(true);
    expect(row().cumulativeOrdersFilled).toBeGreaterThan(0n);
    expect([...owner.db.tickSchedule.iter()].length).toBeLessThanOrEqual(1);
  });

  test('pause and recovery cannot rehabilitate a failed run', async () => {
    const before = await pause();
    await assertRemainsPaused(before, readServer, readCache);
    // The independent query path must retain private-table authorization.
    await expect(
      serverSnapshot(process.env.BACKEND_URI!, database),
    ).rejects.toThrow('authoritative snapshot query failed');
    await owner.reducers.recoverSimulation({});
    await expect
      .poll(async () => (await readServer()).logicalTick)
      .toBeGreaterThan(before.logicalTick);
    const recovered = await readServer();
    expect(recovered.runId).toBe(before.runId);
    expect(recovered.enabled).toBe(true);
    expect(recovered.status).toBe('FAILED');
    expect(recovered.skippedSlots).toBeGreaterThan(0n);
    await expect.poll(readCache).toMatchObject({
      runId: before.runId,
      status: 'FAILED',
      enabled: true,
      generation: recovered.generation,
    });
    await expect
      .poll(() => row().logicalTick)
      .toBeGreaterThan(before.logicalTick);
    await expect
      .poll(() => owner.db.runRecord.runId.find(before.runId)!.skippedSlots)
      .toBeGreaterThan(0n);
    await pause();
  });

  test('authorized receipt view is available without exposing it to other identities', async () => {
    await owner.reducers.authorizeReader({ identity: alice.identity! });
    await expect
      .poll(() => [...alice.db.benchmarkLatestReceipt.iter()].length)
      .toBe(1);
    expect([...bob.db.benchmarkLatestReceipt.iter()]).toHaveLength(0);
  });

  test('replayed IDs remain invalid after receipt pruning', async () => {
    for (let id = 100n; id < 135n; id++) {
      await new Promise((resolve) => setTimeout(resolve, 210));
      await alice.reducers.placeOrder({
        clientOrderId: id,
        side: 'BUY',
        quantity: 1n,
        limitPriceCents: 1n,
      });
      await owner.reducers.benchmarkStep({});
    }
    await expect.poll(() => [...alice.db.myRecentFills.iter()].length).toBe(32);
    expect(
      [...alice.db.myRecentFills.iter()].some((r) => r.clientOrderId === 100n),
    ).toBe(false);
    await expect(
      alice.reducers.placeOrder({
        clientOrderId: 100n,
        side: 'BUY',
        quantity: 1n,
        limitPriceCents: 1n,
      }),
    ).rejects.toThrow();
    expect([...alice.db.myPendingOrder.iter()]).toHaveLength(0);
  });

  test('post-write failure rolls back settlement and evidence; stalled tick requires recovery', async () => {
    await new Promise((resolve) => setTimeout(resolve, 210));
    await alice.reducers.placeOrder({
      clientOrderId: 200n,
      side: 'BUY',
      quantity: 2n,
      limitPriceCents: 10100n,
    });
    await expect.poll(() => [...alice.db.myPendingOrder.iter()].length).toBe(1);
    const tickBefore = row().logicalTick;
    const actorBefore = actorRows(owner)
      .map(
        (a) =>
          `${a.actorId}:${a.cashCents}:${a.shares}:${a.lastStepTick.present}:${a.lastStepTick.value}`,
      )
      .sort();
    const receiptCount = [...owner.db.detailedBenchmarkReceipts.iter()].length;
    await owner.reducers.testSetFault({ failAfterWrites: true });
    await expect(owner.reducers.benchmarkStep({})).rejects.toThrow();
    expect(row().logicalTick).toBe(tickBefore);
    expect(
      actorRows(owner)
        .map(
          (a) =>
            `${a.actorId}:${a.cashCents}:${a.shares}:${a.lastStepTick.present}:${a.lastStepTick.value}`,
        )
        .sort(),
    ).toEqual(actorBefore);
    expect([...owner.db.detailedBenchmarkReceipts.iter()]).toHaveLength(
      receiptCount,
    );
    expect([...alice.db.myTrader.iter()][0].reservedCashCents).toBe(20200n);
    await owner.reducers.recoverSimulation({});
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(row().logicalTick).toBe(tickBefore);
    await owner.reducers.testSetFault({ failAfterWrites: false });
    await owner.reducers.recoverSimulation({});
    await expect.poll(() => row().logicalTick).toBeGreaterThan(tickBefore);
    await expect.poll(() => [...alice.db.myPendingOrder.iter()].length).toBe(0);
    expect(owner.db.runRecord.runId.find(1n)!.status).toBe('FAILED');
  });

  test('late callbacks expose slot gaps; stale generation cannot advance a paused world', async () => {
    const skipped = owner.db.runRecord.runId.find(1n)!.skippedSlots;
    await owner.reducers.testDelayCallback({ delayUs: 300000n });
    await expect
      .poll(() => owner.db.runRecord.runId.find(1n)!.skippedSlots)
      .toBeGreaterThan(skipped);
    expect(
      [...owner.db.detailedBenchmarkReceipts.iter()].some(
        (r) => r.skippedSlots > 0n && r.startLatenessUs >= 50000n,
      ),
    ).toBe(true);
    const before = await pause();
    await owner.reducers.testStaleCallback({});
    // The injected record is due after 1 ms; its eventual deletion is expected,
    // but neither the server tick nor the failed run may change while waiting.
    await expect
      .poll(async () => {
        const current = await readServer();
        expect({ ...current, scheduledTicks: 0 }).toEqual(before);
        return current.scheduledTicks;
      })
      .toBe(0);
    await expect.poll(readCache).toEqual(before);
    await assertRemainsPaused(before, readServer, readCache, 100);
  });

  test('runtime persists PASS, EXITING and COOLDOWN and records a recapitalization grant', async () => {
    const counts = new Map<number, number>();
    for (const actor of actorRows(owner))
      counts.set(actor.bucket, (counts.get(actor.bucket) || 0) + 1);
    const target = [...counts].find(([, count]) => count >= 3)![0];
    for (
      let step = 0;
      step < 20 && Number(row().logicalTick % 20n) !== target;
      step++
    ) {
      const before = row().logicalTick;
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBe(before + 1n);
    }
    const tick = row().logicalTick;
    const due = actorRows(owner)
      .filter((a) => a.bucket === target)
      .sort((a, b) => Number(a.actorId - b.actorId));
    for (const [i, actor] of due.entries()) {
      await owner.reducers.testActorFixture({
        actorId: actor.actorId,
        status: i === 0 ? 'ACTIVE' : i === 1 ? 'EXITING' : 'COOLDOWN',
        cashCents: i === 0 ? 1000n : 0n,
        shares: i === 1 ? 5n : 0n,
        cooldownStartedTick: i >= 2 ? tick : undefined,
      });
    }
    const price = row().priceCents;
    await owner.reducers.benchmarkStep({});
    await expect.poll(() => row().logicalTick).toBe(tick + 1n);
    expect(row().priceCents).toBe(price);
    expect(row().matchedShareVolume).toBe(0n);
    for (const actor of due)
      expect(actorRow(owner, actor.actorId)!.lastStepTick).toEqual({
        value: tick,
        present: true,
      });
    expect(actorRow(owner, due[0].actorId)!.status.tag).toBe('Active');
    expect(actorRow(owner, due[1].actorId)!.status.tag).toBe('Exiting');
    expect(actorRow(owner, due[1].actorId)!.shares).toBe(5n);
    expect(actorRow(owner, due[2].actorId)!.status.tag).toBe('Cooldown');
    const grantsBefore =
      owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents;
    for (let step = 0; step < 20; step++) {
      const before = row().logicalTick;
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBe(before + 1n);
    }
    expect(actorRow(owner, due[2].actorId)!.status.tag).toBe('Active');
    expect(actorRow(owner, due[2].actorId)!.cashCents).toBe(500000n);
    expect(actorRow(owner, due[2].actorId)!.shares).toBe(0n);
    expect(
      owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents -
        grantsBefore,
    ).toBe(BigInt(due.length - 2) * 500000n);
  });

  test('liquidation is quantity-bounded and rejects a below-reserve buyer', async () => {
    const target = actorRows(owner)[0];
    for (
      let step = 0;
      Number(row().logicalTick % 20n) !== target.bucket && step < 20;
      step++
    ) {
      const before = row().logicalTick;
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBe(before + 1n);
    }
    const due = actorRows(owner).filter((a) => a.bucket === target.bucket);
    for (const a of due) {
      await owner.reducers.testActorFixture({
        actorId: a.actorId,
        status: a.actorId === target.actorId ? 'EXITING' : 'ACTIVE',
        cashCents: 10000000n,
        shares: a.actorId === target.actorId ? 500n : 0n,
        cooldownStartedTick: undefined,
      });
    }
    const price = row().priceCents;
    const reserve = (price * 9500n + 9999n) / 10000n;
    await alice.reducers.placeOrder({
      clientOrderId: 201n,
      side: 'BUY',
      quantity: 100n,
      limitPriceCents: 1n,
    });
    let tick = row().logicalTick;
    await owner.reducers.benchmarkStep({});
    await expect.poll(() => row().logicalTick).toBe(tick + 1n);
    expect(actorRow(owner, target.actorId)!.shares).toBe(500n);
    expect(row().priceCents).toBe(price);
    await expect
      .poll(
        () =>
          [...alice.db.myRecentFills.iter()].find(
            (r) => r.clientOrderId === 201n,
          )?.filledQuantity,
      )
      .toBe(0n);
    for (let step = 0; step < 19; step++) {
      tick = row().logicalTick;
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBe(tick + 1n);
    }
    const secondPrice = row().priceCents;
    const secondReserve = (secondPrice * 9500n + 9999n) / 10000n;
    // Other buckets may trade between attempts; compute this auction's reserve.
    // A different funded identity avoids the real-time 200 ms rate limit while
    // manually stepping the simulation faster than wall time.
    await bob.reducers.placeOrder({
      clientOrderId: 202n,
      side: 'BUY',
      quantity: 100n,
      limitPriceCents: secondPrice,
    });
    tick = row().logicalTick;
    await owner.reducers.benchmarkStep({});
    await expect.poll(() => row().logicalTick).toBe(tick + 1n);
    await expect
      .poll(
        () =>
          [...bob.db.myRecentFills.iter()].find((r) => r.clientOrderId === 202n)
            ?.filledQuantity,
      )
      .toBe(10n);
    const actor = actorRow(owner, target.actorId)!;
    expect(actor.shares).toBe(490n);
    expect(actor.status.tag).toBe('Exiting');
    expect(row().priceCents).toBeGreaterThanOrEqual(secondReserve);
    expect(reserve).toBeGreaterThan(1n);
  });

  test('a changed workload stops before actor writes and requires explicit non-qualifying recovery', async () => {
    const configurationHash = row().configurationHash;
    const runHash = '1'.repeat(64);
    await expect(alice.reducers.testStaleConfiguration({})).rejects.toThrow();
    await owner.reducers.testStaleConfiguration({});
    await expect.poll(() => row().configurationHash).toBe('0'.repeat(64));
    const tick = row().logicalTick;
    const rows = actorRows(owner)
      .map(
        (a) =>
          `${a.actorId}:${a.shares}:${a.cashCents}:${a.lastStepTick.value}`,
      )
      .sort();
    await owner.reducers.benchmarkStep({});
    await expect
      .poll(() => owner.db.runRecord.runId.find(1n)!.failureReason)
      .toContain('workload configuration changed');
    expect(row().logicalTick).toBe(tick);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    expect(
      actorRows(owner)
        .map(
          (a) =>
            `${a.actorId}:${a.shares}:${a.cashCents}:${a.lastStepTick.value}`,
        )
        .sort(),
    ).toEqual(rows);
    await owner.reducers.recoverSimulation({});
    await expect.poll(() => row().configurationHash).toBe(configurationHash);
    await expect.poll(() => row().logicalTick).toBeGreaterThan(tick);
    expect(owner.db.runRecord.runId.find(1n)!.status).toBe('FAILED');
    expect(owner.db.runRecord.runId.find(1n)!.configurationHash).toBe(runHash);
    expect(owner.db.runRecord.runId.find(1n)!.failureReason).toContain(
      'authorized non-qualifying recovery after workload change',
    );
    await pause();
  });

  test('distress revival commits bounded grants, retains inventory, and rolls back atomically', async () => {
    await expect(alice.reducers.testClearRevivalState({})).rejects.toThrow();
    await expect(alice.reducers.testStepMany({ count: 1n })).rejects.toThrow();
    await owner.reducers.testClearRevivalState({});
    for (const a of actorRows(owner)) {
      await owner.reducers.testActorFixture({
        actorId: a.actorId,
        status: 'EXITING',
        cashCents: 1000n,
        shares: 10n,
        cooldownStartedTick: undefined,
      });
    }
    const start = row().logicalTick;
    const price = row().priceCents;
    await owner.reducers.testStepMany({ count: 580n });
    await expect.poll(() => row().logicalTick).toBe(start + 580n);
    expect(owner.db.marketDynamics.id.find(0)!.revivedActors).toBe(0n);
    expect(row().activeActorCount).toBe(0n);
    expect(row().priceCents).toBe(price);
    const accounting =
      owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents;
    const target = actorRows(owner).sort(
      (a, b) => a.bucket - b.bucket || Number(a.actorId - b.actorId),
    )[0];
    const exitTick = owner.db.actorRecovery.actorId.find(
      target.actorId,
    )!.exitStartedTick;
    const revivalTick =
      ((exitTick + 600n + 399n) / 400n) * 400n + BigInt(target.bucket);
    await owner.reducers.testStepMany({
      count: revivalTick - row().logicalTick,
    });
    await expect.poll(() => row().logicalTick).toBe(revivalTick);
    const encode = (value: unknown) =>
      JSON.stringify(value, (_key, v: unknown) =>
        typeof v === 'bigint' ? String(v) : v,
      );
    const snapshot = () =>
      encode({
        dynamics: owner.db.marketDynamics.id.find(0),
        health: [...owner.db.bucketHealth.iter()].sort(
          (a, b) => a.bucket - b.bucket,
        ),
        recovery: [...owner.db.actorRecovery.iter()].sort((a, b) =>
          Number(a.actorId - b.actorId),
        ),
        actors: actorRows(owner).sort((a, b) => Number(a.actorId - b.actorId)),
        accounting: owner.db.grantAccounting.id.find(0),
      });
    const before = snapshot();
    await owner.reducers.testSetFault({ failAfterWrites: true });
    await expect(owner.reducers.testStepMany({ count: 1n })).rejects.toThrow();
    expect(snapshot()).toBe(before);
    await owner.reducers.testSetFault({ failAfterWrites: false });
    await owner.reducers.testStepMany({ count: start + 1020n - revivalTick });
    await expect.poll(() => row().logicalTick).toBe(start + 1020n);
    expect(owner.db.marketDynamics.id.find(0)!.revivedActors).toBe(40n);
    expect(row().activeActorCount).toBe(40n);
    expect(row().priceCents).toBe(price); // no fabricated price rebound or trades
    const dynamics = owner.db.marketDynamics.id.find(0)!;
    expect(dynamics.totalGrantsCents).toBeLessThanOrEqual(5000000n);
    expect(
      owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents -
        accounting,
    ).toBe(dynamics.totalGrantsCents);
    expect(actorRows(owner).every((a) => a.shares === 10n)).toBe(true);
    const revivalCount = dynamics.revivedActors;
    await owner.reducers.recoverSimulation({});
    // Accelerated manual ticks can put the original deadline grid in the future.
    // Recovery must preserve that grid, not force an immediate callback.
    await expect
      .poll(() => owner.db.runtimeConfig.id.find(0)!.enabled)
      .toBe(true);
    await pause();
    expect(owner.db.marketDynamics.id.find(0)!.revivedActors).toBe(
      revivalCount,
    );
    expect(owner.db.runRecord.runId.find(1n)!.status).toBe('FAILED');
  });

  test('qualification publication requires admin and three verified fresh runs', async () => {
    await expect(
      alice.reducers.publishBenchmarkResult({
        runIds: [1n, 1n, 1n],
        environment: 'LOCAL',
        evidenceHash: '0'.repeat(64),
      }),
    ).rejects.toThrow();
    await expect(
      alice.reducers.validateRun({
        runId: 1n,
        evidenceHash: '0'.repeat(64),
        loadValid: true,
        connectionHealthy: true,
      }),
    ).rejects.toThrow();
    await expect(
      owner.reducers.publishBenchmarkResult({
        runIds: [1n, 1n, 1n],
        environment: 'LOCAL',
        evidenceHash: '0'.repeat(64),
      }),
    ).rejects.toThrow();
    await expect(
      owner.reducers.validateRun({
        runId: 1n,
        evidenceHash: '0'.repeat(64),
        loadValid: true,
        connectionHealthy: true,
      }),
    ).rejects.toThrow();
  });

  test('incorrect per-actor coverage aborts the tick; reset retains the order watermark', async () => {
    // Choose the next nonempty bucket while stopped.
    while (
      !actorRows(owner).some(
        (a) => a.bucket === Number(row().logicalTick % 20n),
      )
    ) {
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBeGreaterThan(0n);
    }
    const tickBefore = row().logicalTick;
    const actor = actorRows(owner).find(
      (a) => a.bucket === Number(tickBefore % 20n),
    )!;
    await owner.reducers.testCorruptCoverage({ actorId: actor.actorId });
    await expect(owner.reducers.benchmarkStep({})).rejects.toThrow();
    expect(row().logicalTick).toBe(tickBefore);
    await owner.reducers.resetMarket({ confirmation: 'RESET WORLD' });
    while (owner.db.runtimeConfig.id.find(0)!.phase !== 'EMPTY') {
      await owner.reducers.resetBatch({});
    }
    await expect.poll(() => [...owner.db.actorRecovery.iter()].length).toBe(0);
    expect(owner.db.marketDynamics.id.find(0)!.revivedActors).toBe(0n);
    await owner.reducers.setActorPopulation({
      population: 20n,
      seed: 20261003n,
    });
    await owner.reducers.initializeBatch({ count: 20n });
    await alice.reducers.enterMarket({});
    await expect(
      alice.reducers.placeOrder({
        clientOrderId: 200n,
        side: 'BUY',
        quantity: 1n,
        limitPriceCents: 1n,
      }),
    ).rejects.toThrow();
  });

  test('cadence switches preserve the world and create honest independent timing segments', async () => {
    expect(owner.db.cadenceState.id.find(0)!.profile).toBe('20hz');
    await expect(
      owner.reducers.setCadenceProfile({ profile: '11hz' }),
    ).rejects.toThrow();
    const initialActors = actorRows(owner);
    await owner.reducers.setCadenceProfile({ profile: '10hz' });
    await expect
      .poll(() => owner.db.cadenceState.id.find(0)!.profile)
      .toBe('10hz');
    expect(actorRows(owner)).toEqual(initialActors);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    await owner.reducers.startRun({
      profile: 'NORMAL',
      buildHash,
      qualification: false,
    });
    await expect.poll(() => row().logicalTick).toBeGreaterThan(5n);
    await expect(
      owner.reducers.setCadenceProfile({ profile: '20hz' }),
    ).rejects.toThrow();
    const stopped = await pause();
    const firstId = stopped.runId;
    const firstRun = owner.db.runRecord.runId.find(firstId)!;
    const firstTiming = owner.db.runCadence.runId.find(firstId)!;
    expect(firstTiming.tickIntervalUs).toBe(100000n);
    expect(firstTiming.firstLogicalTick).toBe(0n);
    const receipts = [...owner.db.detailedBenchmarkReceipts.iter()].filter(
      (r) => r.runId === firstId,
    );
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) {
      expect(receipt.intendedAt.microsSinceUnixEpoch).toBe(
        firstRun.origin.microsSinceUnixEpoch +
          receipt.intendedSlot * firstTiming.tickIntervalUs,
      );
    }
    // Same-profile selection is idempotent, and recovery stays on this grid.
    await owner.reducers.setCadenceProfile({ profile: '10hz' });
    expect(owner.db.runtimeConfig.id.find(0)!.runId).toBe(firstId);
    await owner.reducers.recoverSimulation({});
    await expect
      .poll(() => row().logicalTick)
      .toBeGreaterThan(stopped.logicalTick);
    await pause();
    const tick = row().logicalTick;
    const actors = actorRows(owner);
    const accounting = owner.db.grantAccounting.id.find(0)!;
    await alice.reducers.placeOrder({
      clientOrderId: 999n,
      side: 'BUY',
      quantity: 1n,
      limitPriceCents: 1n,
    });
    await expect.poll(() => [...alice.db.myPendingOrder.iter()].length).toBe(1);
    await expect
      .poll(() => [...alice.db.myTrader.iter()][0].reservedCashCents)
      .toBe(1n);
    const pendingOrder = [...alice.db.myPendingOrder.iter()][0];
    const human = [...alice.db.myTrader.iter()][0];
    const dynamics = owner.db.marketDynamics.id.find(0)!;
    await owner.reducers.setCadenceProfile({ profile: '20hz' });
    await expect.poll(() => owner.db.runtimeConfig.id.find(0)!.runId).toBe(0n);
    expect(row().logicalTick).toBe(tick);
    expect(actorRows(owner)).toEqual(actors);
    expect(owner.db.grantAccounting.id.find(0)).toEqual(accounting);
    expect([...alice.db.myTrader.iter()][0]).toEqual(human);
    expect([...alice.db.myPendingOrder.iter()][0]).toEqual(pendingOrder);
    expect(owner.db.marketDynamics.id.find(0)).toEqual(dynamics);
    expect(owner.db.runRecord.runId.find(firstId)!.completedAt).toBeDefined();
    expect(owner.db.runRecord.runId.find(firstId)!.configurationHash).toBe(
      firstRun.configurationHash,
    );
    expect(owner.db.runRecord.runId.find(firstId)!.origin).toEqual(
      firstRun.origin,
    );
    const oldEvidence = [...owner.db.detailedBenchmarkReceipts.iter()].filter(
      (r) => r.runId === firstId,
    );
    await expect(owner.reducers.recoverSimulation({})).rejects.toThrow();
    await expect(
      owner.reducers.startRun({
        profile: 'NORMAL',
        buildHash,
        qualification: true,
      }),
    ).rejects.toThrow();
    await owner.reducers.startRun({
      profile: 'NORMAL',
      buildHash,
      qualification: false,
    });
    await expect.poll(() => row().logicalTick).toBeGreaterThan(tick + 20n);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(1);
    const next = await pause();
    expect(next.runId).not.toBe(firstId);
    const nextRun = owner.db.runRecord.runId.find(next.runId)!;
    const nextTiming = owner.db.runCadence.runId.find(next.runId)!;
    expect(nextRun.qualification).toBe(false);
    expect(nextRun.configurationHash).not.toBe(firstRun.configurationHash);
    expect(nextTiming.firstLogicalTick).toBe(tick);
    expect(nextTiming.tickIntervalUs).toBe(50000n);
    const nextReceipts = [...owner.db.detailedBenchmarkReceipts.iter()].filter(
      (r) => r.runId === next.runId,
    );
    for (const receipt of nextReceipts) {
      expect(receipt.intendedAt.microsSinceUnixEpoch).toBe(
        nextRun.origin.microsSinceUnixEpoch +
          receipt.intendedSlot * nextTiming.tickIntervalUs,
      );
      expect(receipt.previousStepsValid).toBe(true);
    }
    expect(
      [...owner.db.detailedBenchmarkReceipts.iter()].filter(
        (r) => r.runId === firstId,
      ),
    ).toEqual(oldEvidence);
    await expect(
      owner.reducers.pruneRunEvidence({
        runId: next.runId,
        confirmation: `PRUNE RUN ${next.runId}`,
      }),
    ).rejects.toThrow();
    await expect(
      owner.reducers.pruneRunEvidence({
        runId: firstId,
        confirmation: 'wrong',
      }),
    ).rejects.toThrow();
    await owner.reducers.pruneRunEvidence({
      runId: firstId,
      confirmation: `PRUNE RUN ${firstId}`,
    });
    await expect.poll(() => owner.db.runRecord.runId.find(firstId)).toBeNull();
    expect(owner.db.runCadence.runId.find(firstId)).toBeNull();
    expect(row().logicalTick).toBe(next.logicalTick);
    expect(actorRows(owner)).toHaveLength(20);
  });

  test('timed 4 Hz runs arm atomically and stop on their server deadline', async () => {
    await owner.reducers.setCadenceProfile({ profile: '4hz' });
    await expect.poll(() => owner.db.runtimeConfig.id.find(0)!.runId).toBe(0n);
    const before = row().logicalTick;
    const args = { profile: 'NORMAL', buildHash, durationSeconds: 1n };
    await expect(alice.reducers.startTimedRun(args)).rejects.toThrow();
    for (const durationSeconds of [0n, 3601n, 18446744073709551615n]) {
      await expect(
        owner.reducers.startTimedRun({ ...args, durationSeconds }),
      ).rejects.toThrow();
    }
    expect(owner.db.runtimeConfig.id.find(0)!.enabled).toBe(false);
    expect([...owner.db.timedRunStop.iter()]).toHaveLength(0);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    await owner.reducers.startTimedRun(args);
    await expect(
      owner.reducers.adoptWorkloadPaused({
        expectedConfigurationHash: row().configurationHash,
      }),
    ).rejects.toThrow('ready, paused world');
    await expect.poll(() => [...owner.db.timedRunStop.iter()].length).toBe(1);
    const stop = [...owner.db.timedRunStop.iter()][0];
    const run = owner.db.runRecord.runId.find(stop.runId)!;
    expect(run.qualification).toBe(false);
    expect(owner.db.runCadence.runId.find(stop.runId)!.tickIntervalUs).toBe(
      250000n,
    );
    expect(stop.deadline.microsSinceUnixEpoch).toBe(
      run.origin.microsSinceUnixEpoch + 1000000n,
    );
    await expect(
      owner.reducers.stopTimedRun({ scheduled: stop }),
    ).rejects.toThrow();
    await expect(
      alice.reducers.stopTimedRun({ scheduled: stop }),
    ).rejects.toThrow();
    await expect(owner.reducers.startTimedRun(args)).rejects.toThrow();
    await expect.poll(() => row().logicalTick).toBeGreaterThan(before);
    await expect
      .poll(() => owner.db.runtimeConfig.id.find(0)!.enabled)
      .toBe(false);
    const stopped = await readServer();
    await expect.poll(readCache).toEqual(stopped);
    expect([...owner.db.timedRunStop.iter()]).toHaveLength(0);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    expect(actorRows(owner)).toHaveLength(20);
    expect(owner.db.runRecord.runId.find(stop.runId)!.status).toBe('FAILED');
    const receipts = [...owner.db.detailedBenchmarkReceipts.iter()].filter(
      (r) => r.runId === stop.runId,
    );
    expect(receipts.length).toBeGreaterThan(0);
    for (const receipt of receipts) {
      expect(receipt.invokedAt.microsSinceUnixEpoch).toBeLessThan(
        stop.deadline.microsSinceUnixEpoch,
      );
      expect(receipt.intendedAt.microsSinceUnixEpoch).toBe(
        run.origin.microsSinceUnixEpoch + receipt.intendedSlot * 250000n,
      );
    }
    await assertRemainsPaused(stopped, readServer, readCache);
  });

  test('bounded continuation keeps the world and cadence, closes only its old segment', async () => {
    const previous = owner.db.runtimeConfig.id.find(0)!.runId;
    const before = await readServer();
    const actors = actorRows(owner).sort((a, b) =>
      Number(a.actorId - b.actorId),
    );
    const oldRun = owner.db.runRecord.runId.find(previous)!;
    const oldReceipts = [...owner.db.detailedBenchmarkReceipts.iter()].filter(
      (r) => r.runId === previous,
    );
    const cadence = owner.db.cadenceState.id.find(0)!;
    const args = { profile: 'NORMAL', buildHash, durationSeconds: 1n };
    await expect(alice.reducers.continueTimedRun(args)).rejects.toThrow();
    for (const invalid of [
      { durationSeconds: 0n },
      { durationSeconds: 3601n },
      { buildHash: 'invalid' },
      { profile: 'invalid' },
    ]) {
      await expect(
        owner.reducers.continueTimedRun({ ...args, ...invalid }),
      ).rejects.toThrow();
      expect(await readServer()).toEqual(before);
      expect(owner.db.runRecord.runId.find(previous)).toEqual(oldRun);
    }
    await owner.reducers.continueTimedRun(args);
    await expect
      .poll(() => owner.db.runtimeConfig.id.find(0)!.runId)
      .not.toBe(previous);
    const next = owner.db.runtimeConfig.id.find(0)!.runId;
    const newRun = owner.db.runRecord.runId.find(next)!;
    expect(newRun.qualification).toBe(false);
    expect(owner.db.runCadence.runId.find(next)!.profile).toBe(cadence.profile);
    expect(owner.db.runCadence.runId.find(next)!.firstLogicalTick).toBe(
      before.logicalTick,
    );
    await expect(owner.reducers.continueTimedRun(args)).rejects.toThrow();
    await expect
      .poll(() => owner.db.runtimeConfig.id.find(0)!.enabled)
      .toBe(false);
    const stopped = await readServer();
    await expect.poll(readCache).toEqual(stopped);
    expect(stopped.logicalTick).toBeGreaterThan(before.logicalTick);
    expect(owner.db.runRecord.runId.find(previous)!.failureReason).toContain(
      oldRun.failureReason,
    );
    expect(owner.db.runRecord.runId.find(previous)!.completedAt).not.toBeNull();
    expect(
      [...owner.db.detailedBenchmarkReceipts.iter()].filter(
        (r) => r.runId === previous,
      ),
    ).toEqual(oldReceipts);
    const immutable = (a: (typeof actors)[number]) => [
      a.actorId,
      a.bucket,
      a.initialEndowmentValueCents,
      a.momentumWeight,
      a.meanReversionWeight,
      a.contrarianWeight,
      a.newsWeight,
      a.riskToleranceBps,
      a.convictionThresholdBps,
    ];
    expect(
      actorRows(owner)
        .sort((a, b) => Number(a.actorId - b.actorId))
        .map(immutable),
    ).toEqual(actors.map(immutable));
    for (const receipt of [...owner.db.detailedBenchmarkReceipts.iter()].filter(
      (r) => r.runId === next,
    )) {
      expect(receipt.previousStepsValid).toBe(true);
      expect(receipt.logicalTick).toBeGreaterThanOrEqual(before.logicalTick);
    }
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    expect([...owner.db.timedRunStop.iter()]).toHaveLength(0);
    await assertRemainsPaused(stopped, readServer, readCache);
  });

  test('early pause cancels the deadline and cannot stop a later run', async () => {
    await owner.reducers.setCadenceProfile({ profile: '10hz' });
    await owner.reducers.startTimedRun({
      profile: 'NORMAL',
      buildHash,
      durationSeconds: 1n,
    });
    await expect.poll(() => [...owner.db.timedRunStop.iter()].length).toBe(1);
    const cancelled = [...owner.db.timedRunStop.iter()][0];
    await pause();
    await expect.poll(() => [...owner.db.timedRunStop.iter()].length).toBe(0);
    await owner.reducers.setCadenceProfile({ profile: '5hz' });
    await owner.reducers.startRun({
      profile: 'NORMAL',
      buildHash,
      qualification: false,
    });
    await expect.poll(() => row().logicalTick).toBeGreaterThan(0n);
    // 20 ticks at 5 Hz pass the cancelled timer's one-second deadline even if
    // the test machine is delayed; no sleep-based cache snapshot assertion.
    const before = row().logicalTick;
    await expect
      .poll(() => row().logicalTick, { timeout: 10000 })
      .toBeGreaterThan(before + 20n);
    expect(owner.db.runtimeConfig.id.find(0)!.enabled).toBe(true);
    expect(owner.db.runtimeConfig.id.find(0)!.runId).not.toBe(cancelled.runId);
    expect([...owner.db.timedRunStop.iter()]).toHaveLength(0);
    await pause();
  });

  test('storage migration rejects live changes; overflow promotion rolls back with a failed tick', async () => {
    await owner.reducers.recoverSimulation({});
    await expect
      .poll(() => owner.db.runtimeConfig.id.find(0)!.enabled)
      .toBe(true);
    await expect(
      owner.reducers.migrateActorStorageBatch({
        startActorId: 1n,
        count: 20n,
        compact: false,
      }),
    ).rejects.toThrow();
    await pause();
    let beforeTick = row().logicalTick;
    let due = actorRows(owner).find(
      (a) => BigInt(a.bucket) === beforeTick % 20n,
    );
    // Hash buckets need not all be occupied in the 20-actor fixture world.
    for (let i = 0; !due && i < 20; i++) {
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBe(beforeTick + 1n);
      beforeTick = row().logicalTick;
      due = actorRows(owner).find((a) => BigInt(a.bucket) === beforeTick % 20n);
    }
    if (!due) throw new Error('No populated actor bucket');
    await owner.reducers.testActorStorageFixture({
      actorId: due.actorId,
      mode: 'promote_on_step',
    });
    await owner.reducers.migrateActorStorageBatch({
      startActorId: due.actorId,
      count: 1n,
      compact: true,
    });
    await expect
      .poll(() => owner.db.actorStateCompact.actorId.find(due.actorId))
      .toBeTruthy();
    const before = actorRows(owner);
    const receiptCount = [...owner.db.detailedBenchmarkReceipts.iter()].length;
    await owner.reducers.testSetFault({ failAfterWrites: true });
    await expect(owner.reducers.benchmarkStep({})).rejects.toThrow();
    expect(row().logicalTick).toBe(beforeTick);
    expect(actorRows(owner)).toEqual(before);
    expect(owner.db.actorStateCompact.actorId.find(due.actorId)).toBeTruthy();
    expect(owner.db.actorState.actorId.find(due.actorId)).toBeFalsy();
    expect([...owner.db.detailedBenchmarkReceipts.iter()]).toHaveLength(
      receiptCount,
    );
    await owner.reducers.testSetFault({ failAfterWrites: false });
    await owner.reducers.benchmarkStep({});
    await expect.poll(() => row().logicalTick).toBe(beforeTick + 1n);
    expect(owner.db.actorStateCompact.actorId.find(due.actorId)).toBeFalsy();
    const promoted = owner.db.actorState.actorId.find(due.actorId)!;
    expect(promoted.markedEquityCents).toBeGreaterThan((1n << 32n) - 1n);
    expect(promoted.lastStepTick).toEqual({ value: beforeTick, present: true });
    await owner.reducers.migrateActorStorageBatch({
      startActorId: due.actorId,
      count: 1n,
      compact: true,
    });
    expect(owner.db.actorState.actorId.find(due.actorId)).toEqual(promoted);
    await pause();
  });

  test('public CHAOS needs no trader/admin role, coalesces concurrent clicks, and never resumes', async () => {
    const viewer = await connect();
    try {
      await subscribe(viewer, [
        'SELECT * FROM market_state',
        'SELECT * FROM news_event',
        'SELECT * FROM my_trader',
      ]);
      expect([...viewer.db.myTrader.iter()]).toHaveLength(0);
      const stopped = await readServer();
      const actors = actorRows(owner);
      const events = [...owner.db.newsEvent.iter()].length;
      await viewer.reducers.triggerChaos({});
      await expect.poll(() => row().chaosActive).toBe(true);
      await expect
        .poll(() => viewer.db.marketState.id.find(0)!.chaosActive)
        .toBe(true);
      await expect
        .poll(() => [...viewer.db.newsEvent.iter()].length)
        .toBe(events + 1);
      const shock = [...viewer.db.newsEvent.iter()]
        .sort((a, b) => Number(a.id - b.id))
        .at(-1)!;
      expect(shock.startTick).toBe(stopped.logicalTick);
      expect(shock.endTick - shock.startTick).toBe(
        60000000n / owner.db.cadenceState.id.find(0)!.tickIntervalUs,
      );
      const expiry = [...owner.db.chaosExpiry.iter()][0];
      expect(expiry.newsId).toBe(shock.id);
      expect(
        expiry.deadline.microsSinceUnixEpoch -
          expiry.startedAt.microsSinceUnixEpoch,
      ).toBe(60000000n);
      await Promise.all([
        viewer.reducers.triggerChaos({}),
        alice.reducers.triggerChaos({}),
        bob.reducers.triggerChaos({}),
      ]);
      expect([...owner.db.newsEvent.iter()]).toHaveLength(events + 1);
      expect(owner.db.newsEvent.id.find(shock.id)).toEqual(shock);
      expect([...owner.db.chaosExpiry.iter()]).toEqual([expiry]);
      expect(actorRows(owner)).toEqual(actors);
      await assertRemainsPaused(stopped, readServer, readCache);
      for (const action of [
        () => viewer.reducers.recoverSimulation({}),
        () => viewer.reducers.pauseSimulation({}),
        () => viewer.reducers.benchmarkStep({}),
        () => viewer.reducers.setCadenceProfile({ profile: '4hz' }),
        () => viewer.reducers.resetMarket({ confirmation: 'RESET WORLD' }),
        () => viewer.reducers.clearChaos({}),
        () => viewer.reducers.expireChaos({ scheduled: expiry }),
        () => owner.reducers.expireChaos({ scheduled: expiry }),
      ])
        await expect(action()).rejects.toThrow();
      // Logical progress alone must not consume a wall-clock minute.
      await owner.reducers.testStepMany({ count: 600n });
      await owner.reducers.testStepMany({ count: 600n });
      await owner.reducers.benchmarkStep({});
      expect(row().chaosActive).toBe(true);
      const beforeClear = await readServer();
      await expect.poll(readCache).toEqual(beforeClear);
      const preservedActors = actorRows(owner);
      await owner.reducers.clearChaos({});
      await expect.poll(() => row().chaosActive).toBe(false);
      expect([...owner.db.chaosExpiry.iter()]).toHaveLength(0);
      expect(owner.db.runtimeConfig.id.find(0)!.chaosSignalBps).toBe(0n);
      expect(actorRows(owner)).toEqual(preservedActors);
      await assertRemainsPaused(beforeClear, readServer, readCache);
      await viewer.reducers.triggerChaos({});
      await expect
        .poll(() => [...owner.db.newsEvent.iter()].length)
        .toBe(events + 2);
      expect(owner.db.runtimeConfig.id.find(0)!.enabled).toBe(false);
      expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
      expect([...owner.db.chaosExpiry.iter()][0].scheduledId).not.toBe(
        expiry.scheduledId,
      );
    } finally {
      viewer.disconnect();
    }
  });

  test('CHAOS expires after one real minute while paused without changing actors or ticks', async () => {
    test.setTimeout(75000);
    const stopped = await readServer();
    await expect.poll(readCache).toEqual(stopped);
    const actors = actorRows(owner);
    const expiry = [...owner.db.chaosExpiry.iter()][0];
    expect(expiry).toBeDefined();
    expect(row().chaosActive).toBe(true);
    await expect
      .poll(() => row().chaosActive, {
        timeout: 65000,
        intervals: [250, 500],
      })
      .toBe(false);
    expect(Date.now() * 1000).toBeGreaterThanOrEqual(
      Number(expiry.deadline.microsSinceUnixEpoch),
    );
    expect([...owner.db.chaosExpiry.iter()]).toHaveLength(0);
    expect(owner.db.runtimeConfig.id.find(0)!.chaosSignalBps).toBe(0n);
    expect(owner.db.newsEvent.id.find(expiry.newsId)!.endTick).toBe(
      stopped.logicalTick,
    );
    expect(actorRows(owner)).toEqual(actors);
    await assertRemainsPaused(stopped, readServer, readCache);
    await alice.reducers.triggerChaos({});
    await expect.poll(() => row().chaosActive).toBe(true);
  });

  test('paused workload adoption verifies the expected hash and preserves actors and old evidence', async () => {
    const expectedConfigurationHash = row().configurationHash;
    await expect(
      alice.reducers.adoptWorkloadPaused({ expectedConfigurationHash }),
    ).rejects.toThrow();
    const sameRuntime = owner.db.runtimeConfig.id.find(0)!;
    await owner.reducers.adoptWorkloadPaused({ expectedConfigurationHash });
    expect(owner.db.runtimeConfig.id.find(0)).toEqual(sameRuntime);
    await owner.reducers.testStaleConfiguration({});
    await expect.poll(() => row().configurationHash).toBe('0'.repeat(64));
    const before = await readServer();
    const actors = actorRows(owner);
    const run = owner.db.runRecord.runId.find(before.runId)!;
    const receipts = [...owner.db.detailedBenchmarkReceipts.iter()];
    const accounting = owner.db.grantAccounting.id.find(0)!;
    await expect(
      owner.reducers.adoptWorkloadPaused({
        expectedConfigurationHash: '0'.repeat(64),
      }),
    ).rejects.toThrow('unexpected compiled configuration hash');
    expect(await readServer()).toEqual(before);
    await owner.reducers.adoptWorkloadPaused({ expectedConfigurationHash });
    await expect
      .poll(() => row().configurationHash)
      .toBe(expectedConfigurationHash);
    await expect.poll(() => owner.db.runtimeConfig.id.find(0)!.runId).toBe(0n);
    const adopted = await readServer();
    await expect.poll(readCache).toEqual(adopted);
    expect(adopted.enabled).toBe(false);
    expect(adopted.logicalTick).toBe(before.logicalTick);
    expect(actorRows(owner)).toEqual(actors);
    expect(owner.db.grantAccounting.id.find(0)).toEqual(accounting);
    expect([...owner.db.detailedBenchmarkReceipts.iter()]).toEqual(receipts);
    const closed = owner.db.runRecord.runId.find(before.runId)!;
    expect(closed.completedAt).toBeDefined();
    expect(closed.status).toBe('FAILED');
    expect(closed.configurationHash).toBe(run.configurationHash);
    expect(closed.buildHash).toBe(run.buildHash);
    expect(closed.origin).toEqual(run.origin);
    expect(closed.failureReason).toContain(run.failureReason);
    expect(closed.failureReason).toContain(
      'authorized paused workload adoption',
    );
    await owner.reducers.adoptWorkloadPaused({ expectedConfigurationHash });
    expect(await readServer()).toEqual(adopted);
    await owner.reducers.setCadenceProfile({ profile: '4hz' });
    await expect
      .poll(() => owner.db.cadenceState.id.find(0)!.tickIntervalUs)
      .toBe(250000n);
    const selected = await readServer();
    await expect.poll(readCache).toEqual(selected);
    await assertRemainsPaused(selected, readServer, readCache);
    expect(selected.logicalTick).toBe(before.logicalTick);
    expect(owner.db.cadenceState.id.find(0)!.requiresExplicitStart).toBe(true);
    expect([...owner.db.timedRunStop.iter()]).toHaveLength(0);
    await expect(owner.reducers.recoverSimulation({})).rejects.toThrow();
    await expect(
      owner.reducers.startRun({
        profile: 'NORMAL',
        buildHash,
        qualification: true,
      }),
    ).rejects.toThrow();
  });

  test('reset clears both actor representations after paused configuration changes', async () => {
    // Reset must remove BOTH physical representations, using bounded batches.
    await owner.reducers.resetMarket({ confirmation: 'RESET WORLD' });
    await expect.poll(() => [...owner.db.chaosExpiry.iter()].length).toBe(0);
    while (owner.db.runtimeConfig.id.find(0)!.phase !== 'EMPTY') {
      await owner.reducers.resetBatch({});
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect([...owner.db.actorState.iter()]).toHaveLength(0);
    expect([...owner.db.actorStateCompact.iter()]).toHaveLength(0);
    await expect.poll(() => [...alice.db.myTrader.iter()].length).toBe(0);
    expect(owner.db.grantAccounting.id.find(0)!.initialShareSupply).toBe(0n);
    expect(owner.db.grantAccounting.id.find(0)!.humanEntryCashCents).toBe(0n);
    expect(row().logicalTick).toBe(0n);
    expect(owner.db.runtimeConfig.id.find(0)!.enabled).toBe(false);
    await owner.reducers.setActorPopulation({
      population: 20n,
      seed: 20261003n,
    });
    await owner.reducers.initializeBatch({ count: 20n });
    await expect.poll(() => row().phase).toBe('READY');
    expect(actorRows(owner)).toHaveLength(20);
    expect(
      actorRows(owner).every(
        (a) =>
          a.cashCents === 250000n &&
          a.shares === 25n &&
          a.lifetimePnlCents === 0n,
      ),
    ).toBe(true);
    expect(owner.db.grantAccounting.id.find(0)!.initialShareSupply).toBe(500n);
    expect(owner.db.grantAccounting.id.find(0)!.actorInitialCashCents).toBe(
      5000000n,
    );
    expect(owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents).toBe(
      0n,
    );
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
    expect([...owner.db.timedRunStop.iter()]).toHaveLength(0);
    expect(row().logicalTick).toBe(0n);
    expect(owner.db.runtimeConfig.id.find(0)!.enabled).toBe(false);
  });
});
