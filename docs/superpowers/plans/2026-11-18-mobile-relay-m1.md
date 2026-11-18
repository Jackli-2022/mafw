# Mobile Relay M1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable relay core (SNI routing, room registry, host control mux, quotas, health) with tests, without touching the gateway or mobile app.

**Architecture:** A new `packages/relay` package. A raw TCP listener parses the TLS ClientHello SNI to find `<roomId>-<routeSecret>.<domain>`, then bridges bytes to the room's host over a multiplexed WebSocket. The host terminates TLS; the relay never sees plaintext.

**Tech Stack:** TypeScript (ESM source, CJS build), Node `net`/`http`, `ws`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §7–§10

## Global Constraints

- Relay never terminates room TLS; it only parses ClientHello and forwards bytes.
- SNI host is exactly `<roomId>-<routeSecret>.<domain>`; roomId and routeSecret are 26-char lowercase base32.
- No gateway/mobile changes in M1.
- Tests use real `net`/`http`/`ws` sockets, not mocked protocol behavior.
- Node 22+; no new dependencies outside the monorepo root (`ws` is already present).
- Commit messages ASCII; run `node --test "src/**/*.test.ts"` in `packages/relay`.

## Review Focus

- A ClientHello split across TCP segments must still yield the SNI.
- A malformed/short/oversized ClientHello must close, never parse a partial host.
- `.`/`..`/uppercase/encoded bytes must not be accepted as room labels.
- A host reconnect must replace the old room connection, not leak it.
- A stream/room over quota must be refused without killing the listener.

---

### Task 1: Package scaffold + SNI parser

**Files:**
- Create: `packages/relay/package.json`
- Create: `packages/relay/tsconfig.json`
- Create: `packages/relay/src/sni.ts`
- Test: `packages/relay/src/sni.test.ts`

**Interfaces:**
- Produces: `parseClientHelloSni(data: Buffer): string | null`
- Produces: `TLS_RECORD_HEADER_BYTES = 5`

- [ ] **Step 1: Write the failing test**

Capture a real ClientHello with `tls.connect` to a temporary `net` server (no cert validation is needed because the server never replies):

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { parseClientHelloSni } from './sni.ts';

test('parses SNI from a real ClientHello', async () => {
  const chunks: Buffer[] = [];
  const server = net.createServer((socket) => socket.on('data', (c) => chunks.push(c)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const client = tls.connect({ host: '127.0.0.1', port, servername: 'room.example.com', rejectUnauthorized: false });
  client.on('error', () => {});
  await new Promise((r) => setTimeout(r, 50));
  client.destroy();
  server.close();
  assert.equal(parseClientHelloSni(Buffer.concat(chunks)), 'room.example.com');
});
```

Add cases for: every 1-byte split of the same buffer; no SNI; truncated buffer; `..`/uppercase host stays literal (validation is Task 2).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/relay && node --test "src/sni.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `package.json`: name `@mafw/relay`, `"type": "module"`, scripts `build` (tsc) and `test` (`node --test "src/**/*.test.ts"`); dependencies `ws` via workspace root (no local install).
- `tsconfig.json`: copy `packages/runtime-core/tsconfig.json` (ES2022, commonjs build, `allowImportingTsExtensions`, `rewriteRelativeImportExtensions`, tests excluded).
- `sni.ts`: parse TLS record header (type 22), handshake type 1, skip version/random/session/ciphers/compression, walk extensions, find `server_name` (0), return the first host_name; return null on any malformed/truncated input.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/relay && node --test "src/sni.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay
git commit -m "feat(relay): add sni parser"
```

---

### Task 2: Room identity + registry

**Files:**
- Create: `packages/relay/src/room.ts`
- Create: `packages/relay/src/registry.ts`
- Test: `packages/relay/src/room.test.ts`
- Test: `packages/relay/src/registry.test.ts`

**Interfaces:**
- Produces: `parseRoomHost(host: string, domain: string): { roomId: string; routeSecret: string } | null`
- Produces: `newRoomId(): string`, `newRouteSecret(): string`, `hashSecret(secret: string): string`
- Produces: `class RoomRegistry { claim(input): RoomClaim; authenticate(roomId, roomToken): RoomClaim | null; attachHost(roomId, conn): boolean; detachHost(roomId, conn): void; get(roomId): RoomClaim | undefined; release(roomId): void; }`

- [ ] **Step 1: Write the failing tests**

```ts
assert.deepEqual(parseRoomHost(`${roomId}-${secret}.relay.example.com`, 'relay.example.com'), { roomId, routeSecret: secret });
assert.equal(parseRoomHost('..-..relay.example.com', 'relay.example.com'), null);
assert.equal(parseRoomHost(`${roomId}-${secret}.relay.example.com.evil`, 'relay.example.com'), null);
assert.equal(parseRoomHost(`${roomId.toUpperCase()}-${secret}.relay.example.com`, 'relay.example.com'), null);
```

Registry: first claim stores hashes; wrong token rejected; re-claim with the right token succeeds; `attachHost` replaces the previous connection and marks the old one replaced; `detachHost` only clears if it is the current connection.

- [ ] **Step 2: Run to fail**

Run: `cd packages/relay && node --test "src/room.test.ts" "src/registry.test.ts"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

- Base32 lower-case generator (16 bytes → 26 chars) using `crypto.randomBytes`; regex `/^[a-z2-7]{26}$/`.
- `parseRoomHost` splits the first label on `-`, requires 2 parts and the exact domain suffix.
- `hashSecret` = `sha256(secret).toString('hex')`; compare with `timingSafeEqual`.
- `RoomClaim` includes roomId, tokenHash, routeSecretHash, createdAt, lastSeenAt, host connection id; registry is in-memory for M1 (SQLite deferred to M2).

- [ ] **Step 4: Run to pass**

Run: `cd packages/relay && node --test "src/room.test.ts" "src/registry.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/relay
git commit -m "feat(relay): add room registry"
```

---

### Task 3: Frames + flow control

**Files:**
- Create: `packages/relay/src/frames.ts`
- Create: `packages/relay/src/flow.ts`
- Test: `packages/relay/src/frames.test.ts`
- Test: `packages/relay/src/flow.test.ts`

**Interfaces:**
- Produces: `encodeFrame(frame: { type: 1|2|3; streamId: number; payload?: Buffer }): Buffer`
- Produces: `decodeFrame(buffer: Buffer): { type; streamId; payload }` (throws on short/oversized)
- Produces: `class StreamWindow { constructor(initial: number); take(n): boolean; credit(n): void; available(): number; }`

- [ ] **Step 1: Write failing tests** for round-trip DATA/WINDOW/CLOSE, max payload, truncated header; window take/credit/overflow.
- [ ] **Step 2: Run to fail** (`node --test "src/frames.test.ts" "src/flow.test.ts"`).
- [ ] **Step 3: Implement** the 10-byte header `[type:1][streamId:4][flags:1][len:4]`, `MAX_FRAME = 256 * 1024`; window starts at 256KB, rejects credit over initial.
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(relay): add frame mux primitives`.

---

### Task 4: Host control hub

**Files:**
- Create: `packages/relay/src/host-hub.ts`
- Test: `packages/relay/src/host-hub.test.ts`

**Interfaces:**
- Produces: `class HostHub { constructor(registry: RoomRegistry); attach(ws): void; openStream(roomId: string): Promise<Duplex>; closeStream(roomId, streamId): void; online(roomId): boolean; }`

- [ ] **Step 1: Write failing test** with a real `ws` server/client: hello with room token → `hello-ok`; open a stream → host receives `open`; host data → stream readable; close → both sides end.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** JSON control frames + binary DATA frames, heartbeat ping/pong, replace-old-host semantics via `RoomRegistry`.
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(relay): add host control hub`.

---

### Task 5: TLS router + server bootstrap

**Files:**
- Create: `packages/relay/src/tls-router.ts`
- Create: `packages/relay/src/server.ts`
- Test: `packages/relay/src/tls-router.test.ts`
- Test: `packages/relay/src/server.test.ts`

**Interfaces:**
- Produces: `createTlsRouter({ domain, registry, hosts, listenHost?, listenPort? }): { start(): Promise<number>; stop(): Promise<void>; port(): number | null }`
- Produces: `createRelayServer({ domain, tlsPort, controlPort, adminPort }): { start(): Promise<void>; stop(): Promise<void>; ports(): {...} }`

- [ ] **Step 1: Write failing test**: real ClientHello → router parses SNI → asks fake host hub for a stream → pipes bytes both ways; unknown room closes; fragmented ClientHello works.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** `net.createServer`: buffer until ClientHello complete (max 16KB, 5s), parse SNI, lookup registry, reject offline, open stream, pipe; `server.ts` wires registry + hub + router + `/health`.
- [ ] **Step 4: Run to pass.**
- [ ] **Step 5: Commit** `feat(relay): add sni tls router`.

---

### Task 6: Quotas + local end-to-end

**Files:**
- Create: `packages/relay/src/quota.ts`
- Create: `packages/relay/src/index.ts`
- Test: `packages/relay/src/quota.test.ts`
- Test: `packages/relay/src/e2e.test.ts`

**Interfaces:**
- Produces: `class Quota { allowRoom(ip): boolean; allowStream(roomId, ip): boolean; allowBytes(roomId, n): boolean; }`
- Produces: `main()` in `index.ts` reading `RELAY_DOMAIN`, `RELAY_TLS_PORT`, `RELAY_CONTROL_PORT`, `RELAY_ADMIN_PORT`.

- [ ] **Step 1: Write failing tests** for per-IP room/day, per-room streams, token-bucket bytes; e2e: start relay, register host, send ClientHello+payload through TCP, assert echo, `/health` 200.
- [ ] **Step 2: Run to fail.**
- [ ] **Step 3: Implement** quotas and CLI bootstrap; document env in `packages/relay/README.md`.
- [ ] **Step 4: Run to pass** and `npm run build -w @mafw/relay`.
- [ ] **Step 5: Commit** `feat(relay): add quotas and local bootstrap`.

---

## Self-Review

- Spec §7–§9 covered: SNI, room identity, host control, frames/flow, router, quotas.
- Spec §10 quotas: per-IP rooms, per-room streams, bandwidth; exact numbers in Task 6.
- M2 (gateway tunnel client), M3 (mobile pinning), M4 (Tencent deployment) are intentionally out of scope; no gateway/mobile changes here.
- Review Focus each has a test in Tasks 1–6.
