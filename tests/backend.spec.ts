import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ScheduleAt } from 'spacetimedb';
import { DbConnection } from './private-bindings';

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
      'SELECT * FROM grant_accounting',
      'SELECT * FROM run_record',
      'SELECT * FROM tick_schedule',
      'SELECT * FROM detailed_benchmark_receipts',
      'SELECT * FROM bucket_manifest',
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
    await expect(alice.reducers.triggerChaos({})).rejects.toThrow();
    await expect(alice.reducers.benchmarkStep({})).rejects.toThrow();
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
    expect([...owner.db.actorState.iter()]).toHaveLength(40);
    expect(owner.db.grantAccounting.id.find(0)!.initialShareSupply).toBe(
      20000n,
    );
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
    for (const table of [
      'human_trader',
      'pending_human_order',
      'human_order_receipt',
      'actor_state',
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
    await owner.reducers.pauseSimulation({});
    await expect
      .poll(() => owner.db.runtimeConfig.id.find(0)!.enabled)
      .toBe(false);
    const before = row().logicalTick;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(row().logicalTick).toBe(before);
    expect(owner.db.runRecord.runId.find(1n)!.status).toBe('FAILED');
    await owner.reducers.recoverSimulation({});
    await expect.poll(() => row().logicalTick).toBeGreaterThan(before);
    expect(owner.db.runRecord.runId.find(1n)!.status).toBe('FAILED');
    expect(owner.db.runRecord.runId.find(1n)!.skippedSlots).toBeGreaterThan(0n);
    await owner.reducers.pauseSimulation({});
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
    const actorBefore = [...owner.db.actorState.iter()]
      .map((a) => `${a.actorId}:${a.cashCents}:${a.shares}:${a.lastStepTick}`)
      .sort();
    const receiptCount = [...owner.db.detailedBenchmarkReceipts.iter()].length;
    await owner.reducers.testSetFault({ failAfterWrites: true });
    await expect(owner.reducers.benchmarkStep({})).rejects.toThrow();
    expect(row().logicalTick).toBe(tickBefore);
    expect(
      [...owner.db.actorState.iter()]
        .map((a) => `${a.actorId}:${a.cashCents}:${a.shares}:${a.lastStepTick}`)
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
    await owner.reducers.pauseSimulation({});
    const before = row().logicalTick;
    await owner.reducers.testStaleCallback({});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(row().logicalTick).toBe(before);
    expect([...owner.db.tickSchedule.iter()]).toHaveLength(0);
  });

  test('runtime persists PASS, EXITING and COOLDOWN and records a recapitalization grant', async () => {
    const counts = new Map<number, number>();
    for (const actor of owner.db.actorState.iter())
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
    const due = [...owner.db.actorState.iter()]
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
      expect(
        owner.db.actorState.actorId.find(actor.actorId)!.lastStepTick,
      ).toBe(tick);
    expect(owner.db.actorState.actorId.find(due[0].actorId)!.status).toBe(
      'ACTIVE',
    );
    expect(owner.db.actorState.actorId.find(due[1].actorId)!.status).toBe(
      'EXITING',
    );
    expect(owner.db.actorState.actorId.find(due[1].actorId)!.shares).toBe(5n);
    expect(owner.db.actorState.actorId.find(due[2].actorId)!.status).toBe(
      'COOLDOWN',
    );
    const grantsBefore =
      owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents;
    for (let step = 0; step < 20; step++) {
      const before = row().logicalTick;
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBe(before + 1n);
    }
    expect(owner.db.actorState.actorId.find(due[2].actorId)!.status).toBe(
      'ACTIVE',
    );
    expect(owner.db.actorState.actorId.find(due[2].actorId)!.cashCents).toBe(
      10000000n,
    );
    expect(owner.db.actorState.actorId.find(due[2].actorId)!.shares).toBe(0n);
    expect(
      owner.db.grantAccounting.id.find(0)!.recapitalizationCashCents -
        grantsBefore,
    ).toBe(BigInt(due.length - 2) * 10000000n);
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
      ![...owner.db.actorState.iter()].some(
        (a) => a.bucket === Number(row().logicalTick % 20n),
      )
    ) {
      await owner.reducers.benchmarkStep({});
      await expect.poll(() => row().logicalTick).toBeGreaterThan(0n);
    }
    const tickBefore = row().logicalTick;
    const actor = [...owner.db.actorState.iter()].find(
      (a) => a.bucket === Number(tickBefore % 20n),
    )!;
    await owner.reducers.testCorruptCoverage({ actorId: actor.actorId });
    await expect(owner.reducers.benchmarkStep({})).rejects.toThrow();
    expect(row().logicalTick).toBe(tickBefore);
    await owner.reducers.resetMarket({ confirmation: 'RESET WORLD' });
    while (owner.db.runtimeConfig.id.find(0)!.phase !== 'EMPTY') {
      await owner.reducers.resetBatch({});
    }
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
});
