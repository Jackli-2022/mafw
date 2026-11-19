# Mobile Relay M2 (Gateway Client) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the gateway own a stable relay room, self-signed TLS certificate and outbound control connection, and advertise relay URL + certificate fingerprint in pairing links.

**Architecture:** The gateway persists `roomId/roomToken/routeSecret` + key/cert, runs a loopback HTTPS terminator, and keeps an outbound WSS to the M1 relay. Each relay `open` stream is bridged to the terminator, which terminates TLS + injects the M0 marker before proxying to `:3000`.

**Tech Stack:** TypeScript, Node `https`/`net`, `ws`, `selfsigned`; Jest in `gateway`.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §7–§9

## Global Constraints

- Relay is **off by default**; nothing starts unless `mobile.relay.enabled` is true and URL/domain are configured.
- Room identity + private key live in `~/.mafw/mobile/relay/` with `0600` files; never log tokens/keys.
- Fingerprint = SHA-256 of the certificate DER, lowercase hex; pairing link carries it as `fp`.
- `url`/nonce/v=2 behavior stays backward compatible; new params are additive.
- No mobile app changes in M2 (extra link params are ignored by the current parser).
- No public listen port on the gateway; terminator stays loopback.
- Jest: `npx jest tests/unit/mobile/... --runInBand`; typecheck `npx tsc --noEmit -p tsconfig.json`.

## Review Focus

- Corrupt/missing room.json must not silently create a new room while a phone still pins the old URL.
- Cert SAN must exactly equal the Room URL host; fingerprint must match the served cert.
- TLS terminator must still inject the M0 marker and never proxy a tunneled request to the runtime.
- Relay client must reconnect with backoff and must not leak local sockets on `close`.
- A pairing link without relay config must be byte-compatible with today's link.

---

### Task 1: Relay identity store

**Files:**
- Create: `gateway/src/mobile/relay-identity.ts`
- Test: `gateway/tests/unit/mobile/relay-identity.test.ts`

**Interfaces:**
- Produces: `loadOrCreateRelayIdentity(dir: string, opts: { domain: string }): RelayIdentity`
- Produces: `RelayIdentity { roomId, roomToken, routeSecret, host, roomUrl, certPem, keyPem, fingerprint }`
- Produces: `fingerprintCertificate(certPem: string): string`

- [ ] **Step 1: Write failing tests** with a temp dir: first call creates 4 files; second call returns identical room + cert; file modes are 0600; fingerprint is 64 hex; cert SAN equals host; corrupt `room.json` throws rather than regenerating.
- [ ] **Step 2: Run to fail** (`npx jest tests/unit/mobile/relay-identity.test.ts --runInBand`).
- [ ] **Step 3: Implement** with `selfsigned.generate` (2048-bit RSA, 10y, SAN DNS host), `fs` atomic writes, `crypto.X509Certificate`.
- [ ] **Step 4: Run to pass**, `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit** `feat(mobile): add relay identity store`.

### Task 2: Pairing link relay params

**Files:**
- Modify: `gateway/src/mobile/pairing.ts`
- Test: `gateway/tests/unit/mobile/pairing-v2.test.ts`

**Interfaces:**
- Produces: `setRelayEndpoint(endpoint: { url: string; fingerprint: string } | null): void`
- Pairing URL adds `relayUrl` and `fp` only when set.

- [ ] **Step 1: Add failing tests**: link without endpoint has no `relayUrl`/`fp`; with endpoint both are present and `url` stays LAN; clearing restores the old shape.
- [ ] **Step 2: Run to fail**.
- [ ] **Step 3: Implement** the endpoint fields and URLSearchParams additions.
- [ ] **Step 4: Run to pass**, plus existing pairing tests.
- [ ] **Step 5: Commit** `feat(mobile): add relay endpoint to pairing links`.

### Task 3: TLS terminator

**Files:**
- Modify: `gateway/src/mobile/tunnel-terminator.ts`
- Test: `gateway/tests/unit/mobile/tunnel-terminator.test.ts`

**Interfaces:**
- `TunnelTerminatorOptions.tls?: { key: string; cert: string }`; when present use `https.createServer`.

- [ ] **Step 1: Add failing tests**: HTTPS request to the terminator succeeds with `rejectUnauthorized:false`; target sees the marker; HTTP request to a TLS terminator fails; existing HTTP tests still pass.
- [ ] **Step 2: Run to fail**.
- [ ] **Step 3: Implement** `https.createServer` when `tls` is set; keep request/upgrade proxy logic unchanged.
- [ ] **Step 4: Run to pass**.
- [ ] **Step 5: Commit** `feat(mobile): support tls on the terminator`.

### Task 4: Relay tunnel client

**Files:**
- Create: `gateway/src/mobile/relay-tunnel-client.ts`
- Test: `gateway/tests/unit/mobile/relay-tunnel-client.test.ts`

**Interfaces:**
- `class RelayTunnelClient { constructor(opts: { url; roomId; roomToken; routeSecret; localPort; WebSocketImpl?; reconnectMs? }); start(): void; stop(): void; status(): { connected: boolean; lastError?: string }; }`
- Sends `hello`; on `open` connects to `127.0.0.1:localPort`; DATA/CLOSE bridge; reconnects with capped backoff.

- [ ] **Step 1: Write failing tests** with a fake WSS relay + local echo TCP server: hello fields; open → local connect; binary echo both ways; close ends local socket; stop closes ws; reconnect after relay close.
- [ ] **Step 2: Run to fail**.
- [ ] **Step 3: Implement** with `ws` and `net`.
- [ ] **Step 4: Run to pass**.
- [ ] **Step 5: Commit** `feat(mobile): add relay tunnel client`.

### Task 5: Config wiring + local end-to-end

**Files:**
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/mobile/relay-e2e.test.ts`
- Modify: `docs/architecture/mobile.md`

- [ ] **Step 1: Write failing e2e** using M1 `packages/relay`: start relay server, identity, TLS terminator on an ephemeral port, tunnel client, target HTTP server; send a real TLS request through the relay with the room SNI; assert response + marker + cert fingerprint.
- [ ] **Step 2: Run to fail**.
- [ ] **Step 3: Wire kernel**: if `mobile.relay.enabled`, load identity, start TLS terminator + client, set pairing endpoint; stop on shutdown. Config keys `mobile.relay.{enabled,url,roomDomain,controlUrl}`.
- [ ] **Step 4: Run to pass**, `npx tsc`, broad mobile/http/routes suites.
- [ ] **Step 5: Commit** `feat(mobile): wire relay client into the gateway` + docs note.

## Self-Review

- Spec §8 (identity/cert/pairing), §7.2 (tunnel), §9 (frames) covered.
- Review Focus tests: corrupt store (Task 1), SAN/fingerprint (1/3/5), marker (3/5), reconnect/socket cleanup (4), link compatibility (2).
- M3 (mobile pinning/dual endpoint) and M4 (Tencent deploy) remain out of scope.
