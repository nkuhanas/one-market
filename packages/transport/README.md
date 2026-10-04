# Ordered client transport

Both the browser connection and backend integration clients use
`openOrderedWebSocket` through the SDK's public `withWSFn` extension point.
SpacetimeDB 2.10.1's default adapter decompresses concurrent messages before
its inbound queue: a plain transaction can overtake an earlier gzip transaction
and leave the cache permanently stale. The retained reproduction is in
`artifacts/verification/20261004-actor-capacity/reproduce-sdk-ordering.mjs`.

This adapter queues raw WebSocket frames and completes decompression and
delivery one at a time. It preserves binary bytes, protocol negotiation, gzip /
brotli / plain tags, temporary-token authentication, and confirmed-read options.
It requires the repository's Node 24 or a browser with native WebSocket and
DecompressionStream support. Authenticated connection setup has a 10-second
token-exchange deadline. No long-lived token is put into the WebSocket URL.

Closing a connection cancels active decoding and clears pending frames so they
cannot update a disposed client. Malformed frames fail the connection; they are
never skipped while later transactions continue. Application reconnect uses a
new socket and subscription, as before. Like the pinned SDK, the receive queue
has no application-imposed message-size limit; this does not add flow control
for clients that cannot keep up. Only compressed wire frames wait in the queue,
with at most one decode in flight.

`tests/transport.spec.ts` covers Node ordering, byte preservation, cancellation,
errors, and authentication. `tests/integration.spec.ts` checks real Chromium
WebSocket ordering plus existing live connection, ping, disconnect, and
reconnect behavior. The runtime pause tests retain their authoritative fences.

No SDK internals, generated bindings, or installed dependencies are patched.
Re-evaluate removal when upgrading the SDK: the deterministic mixed-frame
regression must pass against the replacement before switching consumers back.
