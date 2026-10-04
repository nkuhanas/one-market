import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { asEventKind } from '../apps/web/src/market/contract';

test('lifecycle activity is never classified as a filled trade', () => {
  expect(asEventKind('WIPED — DRAWDOWN LIMIT')).toBe('WIPED');
  expect(asEventKind('COOLDOWN')).toBe('COOLDOWN');
  expect(asEventKind('RECAPITALIZED')).toBe('RECAPITALIZED');
  expect(asEventKind('REVIVED — INVENTORY RETAINED')).toBe('REVIVED');
  expect(asEventKind('future event')).toBe('UNKNOWN');
  expect(asEventKind('FILLED')).toBe('FILLED');
});

async function openMarket(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');
}

async function tick(page: Page) {
  return BigInt(
    (await page.getByTestId('tick').innerText()).replaceAll(',', ''),
  );
}

test('independent browsers share a live tick and can call the runtime', async ({
  browser,
}, testInfo) => {
  const first = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  try {
    await Promise.all([openMarket(a), openMarket(b)]);
    const initial = await tick(a);
    await expect.poll(() => tick(a)).toBeGreaterThan(initial + 3n);
    // Compare a common observed tick without assuming browser renders are simultaneous.
    const common = await tick(a);
    await expect.poll(() => tick(b)).toBeGreaterThanOrEqual(common);
    expect(await tick(b)).toBeLessThan(common + 40n);
    await a.getByRole('button', { name: 'Ping runtime' }).click();
    await expect(a.getByRole('status')).toHaveText('Ping confirmed');
    await a.screenshot({
      path: testInfo.outputPath('desktop.png'),
      fullPage: true,
    });
    await a.setViewportSize({ width: 390, height: 844 });
    await a.screenshot({
      path: testInfo.outputPath('mobile.png'),
      fullPage: true,
    });
  } finally {
    await first.close();
    await second.close();
  }
});

test('reports a dropped connection and reconnects to live state', async ({
  page,
}) => {
  let socket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/v1\/database\/.*\/subscribe/, (route) => {
    socket = route;
    route.connectToServer();
  });
  await openMarket(page);
  const initial = await tick(page);
  expect(socket).toBeDefined();
  await socket!.close({ code: 1001, reason: 'Integration test disconnect' });
  await expect(page.getByTestId('connection-status')).toHaveText(
    'Disconnected',
  );
  await expect(
    page.getByRole('button', { name: 'Ping runtime' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByTestId('connection-status')).toHaveText('Connected');
  await expect.poll(() => tick(page)).toBeGreaterThan(initial);
});

test('browser transport preserves mixed gzip/plain wire order', async ({
  page,
}) => {
  await page.routeWebSocket(
    /\/v1\/database\/transport-order-test\/subscribe/,
    (route) => {
      const url = new URL(route.url());
      expect(url.searchParams.get('compression')).toBe('Gzip');
      expect(url.searchParams.get('confirmed')).toBe('true');
      for (let id = 1; id <= 20; id++) {
        const compressed = id % 2 === 1;
        const data = new Uint8Array(compressed ? 256 * 1024 : 1).fill(id);
        route.send(
          Buffer.concat([
            Buffer.from([compressed ? 2 : 0]),
            compressed ? gzipSync(data) : data,
          ]),
        );
      }
    },
  );
  await openMarket(page);
  const messages = await page.evaluate(
    async (modulePath) => {
      const { openOrderedWebSocket } = await import(
        /* @vite-ignore */ modulePath
      );
      const socket = await openOrderedWebSocket({
        url: new URL('ws://ordered.test'),
        nameOrAddress: 'transport-order-test',
        wsProtocol: ['v2.bsatn.spacetimedb'],
        compression: 'gzip',
        lightMode: false,
        confirmedReads: true,
      });
      return await new Promise<number[]>((resolve, reject) => {
        const received: number[] = [];
        socket.onerror = (error: ErrorEvent) =>
          reject(new Error(error.message));
        socket.onmessage = ({ data }: { data: Uint8Array }) => {
          received.push(data[0]);
          if (received.length === 20) {
            socket.close();
            resolve(received);
          }
        };
      });
    },
    `/@fs${resolve('packages/transport/src/index.ts')}`,
  );
  expect(messages).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
});
