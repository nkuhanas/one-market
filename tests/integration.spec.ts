import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

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
