import { expect, test } from '@playwright/test';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { OrderedWebSocket, openOrderedWebSocket } from '@one-market/transport';

class Socket {
  binaryType = 'blob';
  protocol = 'v2.bsatn.spacetimedb';
  readyState = 1;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  onclose?: (event: CloseEvent) => void;
  onerror?: (event: Event) => void;
  onopen?: () => void;
  sent: Uint8Array[] = [];
  closes = 0;
  send(message: Uint8Array) {
    this.sent.push(message);
  }
  close() {
    this.closes++;
    this.readyState = 3;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }
  emit(bytes: Uint8Array) {
    this.onmessage?.({ data: Uint8Array.from(bytes).buffer });
  }
}

const wire = (id: number, gzip: boolean) => {
  const data = new Uint8Array(gzip ? 256 * 1024 : 1).fill(id);
  return Buffer.concat([
    Buffer.from([gzip ? 2 : 0]),
    gzip ? gzipSync(data) : data,
  ]);
};
const setup = () => {
  const socket = new Socket();
  const adapter = new OrderedWebSocket(socket as unknown as WebSocket);
  return { socket, adapter };
};

test('gzip and plain frames enter the SDK in exact wire order, repeatedly', async () => {
  for (let trial = 0; trial < 10; trial++) {
    const { socket, adapter } = setup();
    const received: number[] = [];
    const finished = new Promise<void>((resolve, reject) => {
      adapter.onerror = (e) => reject(new Error(e.message));
      adapter.onmessage = ({ data }) => {
        received.push(data[0]);
        if (received.length === 20) resolve();
      };
    });
    for (let id = 1; id <= 20; id++) socket.emit(wire(id, id % 2 === 1));
    await finished;
    expect(received).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    adapter.close();
  }
});

test('plain and brotli tags preserve bytes as well as order', async () => {
  const { socket, adapter } = setup();
  const received: Uint8Array[] = [];
  const payload = Uint8Array.from([0, 255, 128, 1]);
  const finished = new Promise<void>((resolve, reject) => {
    adapter.onerror = (e) => reject(new Error(e.message));
    adapter.onmessage = ({ data }) => {
      received.push(data);
      if (received.length === 2) resolve();
    };
  });
  socket.emit(Buffer.concat([Buffer.from([1]), brotliCompressSync(payload)]));
  socket.emit(Buffer.concat([Buffer.from([0]), payload]));
  await finished;
  expect(received).toEqual([payload, payload]);
  adapter.close();
});

for (const remote of [false, true]) {
  test(`${remote ? 'remote' : 'local'} close cancels decompression and drops pending callbacks`, async () => {
    const { socket, adapter } = setup();
    const received: number[] = [];
    let closed = 0;
    adapter.onmessage = ({ data }) => received.push(data[0]);
    adapter.onclose = () => closed++;
    socket.emit(wire(1, true));
    socket.emit(wire(2, false));
    if (remote) socket.close();
    else adapter.close();
    socket.emit(wire(3, false));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received).toEqual([]);
    expect(closed).toBe(1);
    expect(adapter.readyState).toBe(3);
  });
}

for (const bytes of [
  new Uint8Array(),
  Uint8Array.of(9, 1),
  Uint8Array.of(2, 1, 2),
]) {
  test(`invalid frame ${Array.from(bytes)} fails closed without delivering later rows`, async () => {
    const { socket, adapter } = setup();
    const received: number[] = [];
    const failed = new Promise<string>((resolve) => {
      adapter.onerror = (e) => resolve(e.message);
    });
    adapter.onmessage = ({ data }) => received.push(data[0]);
    socket.emit(bytes);
    socket.emit(wire(2, false));
    expect(await failed).toBe('Unable to decode ordered database message');
    expect(socket.closes).toBe(1);
    expect(received).toEqual([]);
  });
}

test('forwards protocol, ready state, outbound bytes, open and error events', () => {
  const { socket, adapter } = setup();
  expect(socket.binaryType).toBe('arraybuffer');
  expect(adapter.protocol).toBe(socket.protocol);
  expect(adapter.readyState).toBe(1);
  const bytes = Uint8Array.of(4, 2);
  adapter.send(bytes);
  expect(socket.sent).toEqual([bytes]);
  let opened = false;
  let failed = false;
  adapter.onopen = () => {
    opened = true;
  };
  adapter.onerror = () => {
    failed = true;
  };
  socket.onopen?.();
  socket.onerror?.(new Event('error'));
  expect(opened && failed).toBe(true);
});

test('factory keeps compression, confirmation, protocol and temporary-token authentication', async () => {
  const native = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  const sockets: { url: URL; protocols: string[] }[] = [];
  let exchanges = 0;
  try {
    globalThis.WebSocket = class extends Socket {
      constructor(url: string | URL, protocols: string[]) {
        super();
        sockets.push({ url: new URL(url), protocols });
      }
    } as unknown as typeof WebSocket;
    globalThis.fetch = async (input, init) => {
      exchanges++;
      expect(String(input)).toBe(
        'https://example.test/v1/identity/websocket-token',
      );
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer long-lived-test-token',
      );
      return Response.json({ token: 'temporary-test-token' });
    };
    const args = {
      url: new URL('wss://example.test'),
      nameOrAddress: 'market',
      wsProtocol: ['v2.bsatn.spacetimedb'],
      compression: 'gzip' as const,
      lightMode: false,
      confirmedReads: true,
    };
    const authenticated = await openOrderedWebSocket({
      ...args,
      authToken: 'long-lived-test-token',
    });
    expect(sockets[0].url.toString()).toBe(
      'wss://example.test/v1/database/market/subscribe?token=temporary-test-token&compression=Gzip&confirmed=true',
    );
    expect(sockets[0].protocols).toEqual(args.wsProtocol);
    authenticated.close();
    const anonymous = await openOrderedWebSocket({
      ...args,
      compression: 'none',
      lightMode: true,
      confirmedReads: false,
    });
    expect(sockets[1].url.toString()).toBe(
      'wss://example.test/v1/database/market/subscribe?compression=None&light=true&confirmed=false',
    );
    expect(exchanges).toBe(1);
    anonymous.close();
    globalThis.fetch = async () =>
      new Response('do not expose this body', { status: 401 });
    await expect(
      openOrderedWebSocket({ ...args, authToken: 'long-lived-test-token' }),
    ).rejects.toThrow('WebSocket token exchange failed (401)');
    globalThis.fetch = async () => Response.json({ token: null });
    await expect(
      openOrderedWebSocket({ ...args, authToken: 'long-lived-test-token' }),
    ).rejects.toThrow('invalid token');
    expect(sockets).toHaveLength(2);
  } finally {
    globalThis.fetch = native.fetch;
    globalThis.WebSocket = native.WebSocket;
  }
});
