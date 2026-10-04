// Diagnostic only: transpile the installed, unmodified pinned SDK adapter in
// memory. No network, credentials, SDK patches, or dependency changes are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const sdk = 'node_modules/spacetimedb';
const version = JSON.parse(fs.readFileSync(`${sdk}/package.json`, 'utf8')).version;
assert.equal(version, '2.10.1');
const hashes = {};
function load(name, dependencies) {
  const source = fs.readFileSync(`${sdk}/src/sdk/${name}.ts`, 'utf8');
  hashes[name] = createHash('sha256').update(source).digest('hex');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (id) => {
      assert(Object.hasOwn(dependencies, id), `unexpected import ${id}`);
      return dependencies[id];
    },
    console,
    Uint8Array,
    ReadableStream,
    DecompressionStream,
  });
  return exports;
}
const decompress = load('decompress', {});
const { WebsocketDecompressAdapter } = load('websocket_decompress_adapter', {
  './decompress': decompress,
  './ws': {}, // The socket is supplied directly; openWebSocket is never called.
});

async function deliver(compressFirst) {
  const socket = { close() { throw Error('unexpected close'); } };
  const adapter = new WebsocketDecompressAdapter(socket);
  const callbacks = [];
  adapter.onmessage = ({ data }) => callbacks.push(data[0]);
  const original = new Uint8Array(256 * 1024).fill(1);
  const payload = compressFirst ? gzipSync(original) : original;
  const first = new Uint8Array(payload.length + 1);
  first[0] = compressFirst ? 2 : 0;
  first.set(payload, 1);
  const second = new Uint8Array([0, 2]);
  // WebSocket dispatch does not await the async callback before the next frame.
  const pendingFirst = socket.onmessage({ data: first.buffer });
  const pendingSecond = socket.onmessage({ data: second.buffer });
  await Promise.all([pendingFirst, pendingSecond]);
  return callbacks;
}

const mixedFrames = [];
const uncompressedFrames = [];
for (let repeat = 0; repeat < 10; repeat++) {
  mixedFrames.push(await deliver(true));
  uncompressedFrames.push(await deliver(false));
}
assert(mixedFrames.every((order) => order.join(',') === '2,1'));
assert(uncompressedFrames.every((order) => order.join(',') === '1,2'));
console.log(JSON.stringify({
  sdk_version: version,
  node_version: process.version,
  source_sha256: hashes,
  wire_order: [1, 2],
  mixed_gzip_then_plain_callback_order: mixedFrames,
  plain_then_plain_callback_order: uncompressedFrames,
  finding: 'The unmodified SDK starts decompression concurrently and invokes the later plain frame callback before the earlier gzip frame callback.',
  limitation: 'This reproduces the adapter ordering defect with real gzip data. CI did not retain a wire trace, so attribution of its stale cache to this defect remains an evidence-backed hypothesis.',
}, null, 2));
