import type { DbConnectionBuilder } from 'spacetimedb';

// Infer the extension contract from the public SDK API, not private SDK paths
// or generated bindings. The factory is independent of a module's row types.
type WebSocketFactory = Parameters<DbConnectionBuilder<never>['withWSFn']>[0];
type WebSocketAdapter = Awaited<ReturnType<WebSocketFactory>>;

/**
 * SDK 2.10.1 starts decompression concurrently, before its inbound queue.
 * Queue raw frames here so a small/plain transaction cannot overtake gzip.
 * Native WebSocket + DecompressionStream are available in our Node 24/browser
 * targets. This adapter can be removed when the pinned SDK fixes wire ordering.
 */
export class OrderedWebSocket implements WebSocketAdapter {
  onopen: () => void = () => {};
  onmessage: (msg: { data: Uint8Array }) => void = () => {};
  onclose: (event: CloseEvent) => void = () => {};
  onerror: (event: ErrorEvent) => void = () => {};

  readonly #socket: WebSocket;
  readonly #queue: ArrayBuffer[] = [];
  #draining = false;
  #stopped = false;
  #reader?: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (!this.#stopped) this.onopen();
    };
    socket.onerror = (event) => this.onerror(event as ErrorEvent);
    socket.onclose = (event) => {
      this.#stop();
      this.onclose(event);
    };
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.#stopped) return;
      if (!(event.data instanceof ArrayBuffer)) {
        this.#fail();
        return;
      }
      this.#queue.push(event.data);
      void this.#drain();
    };
  }

  get protocol(): string {
    return this.#socket.protocol;
  }

  get readyState(): number {
    return this.#socket.readyState;
  }

  send(message: Uint8Array<ArrayBuffer>): void {
    this.#socket.send(message);
  }

  close(): void {
    this.#stop();
    this.#socket.close();
  }

  #stop(): void {
    this.#stopped = true;
    this.#queue.length = 0;
    void this.#reader?.cancel().catch(() => {});
  }

  #fail(): void {
    if (this.#stopped) return;
    // No payload, URL, or credentials in diagnostics. The SDK consumes message
    // from ErrorEvent; Node's native WebSocket does not expose that constructor.
    const error = { message: 'Unable to decode ordered database message' };
    this.close();
    this.onerror(error as ErrorEvent);
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (!this.#stopped && this.#queue.length > 0) {
        const frame = new Uint8Array(this.#queue.shift()!);
        const data = await this.#decode(frame);
        if (!this.#stopped) this.onmessage({ data });
      }
    } catch {
      this.#fail();
    } finally {
      this.#draining = false;
    }
  }

  async #decode(frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const payload = frame.subarray(1);
    if (frame[0] === 0) return payload;
    if (frame[0] !== 1 && frame[0] !== 2) throw new Error('Invalid frame');
    const format = frame[0] === 2 ? 'gzip' : ('brotli' as CompressionFormat);
    const reader = new Blob([payload])
      .stream()
      .pipeThrough(new DecompressionStream(format))
      .getReader();
    this.#reader = reader;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (!this.#stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
      this.#reader = undefined;
    }
    const decoded = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      decoded.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decoded;
  }
}

/** Preserve SDK 2.10.1's token exchange and wire options; only ordering differs. */
export const openOrderedWebSocket: WebSocketFactory = async ({
  url,
  wsProtocol,
  nameOrAddress,
  authToken,
  compression,
  lightMode,
  confirmedReads,
}) => {
  const databaseUrl = new URL(`v1/database/${nameOrAddress}/subscribe`, url);
  if (authToken) {
    const tokenUrl = new URL('v1/identity/websocket-token', url);
    tokenUrl.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(`WebSocket token exchange failed (${response.status})`);
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== 'object' ||
      !('token' in result) ||
      typeof result.token !== 'string' ||
      result.token.length === 0
    ) {
      throw new Error('WebSocket token exchange returned an invalid token');
    }
    databaseUrl.searchParams.set('token', result.token);
  }
  databaseUrl.searchParams.set(
    'compression',
    { gzip: 'Gzip', brotli: 'Brotli', none: 'None' }[compression],
  );
  if (lightMode) databaseUrl.searchParams.set('light', 'true');
  if (confirmedReads !== undefined)
    databaseUrl.searchParams.set('confirmed', String(confirmedReads));
  return new OrderedWebSocket(new WebSocket(databaseUrl, wsProtocol));
};
