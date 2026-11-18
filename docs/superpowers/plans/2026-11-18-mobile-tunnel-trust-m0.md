# Mobile Tunnel Trust Boundary (M0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop relayed/tunneled requests from inheriting loopback `local` trust, while keeping Quick Tunnel pairing and WS working.

**Architecture:** A loopback-only terminator injects a per-process secret header into every tunneled request. `resolvePrincipal` turns marker-bearing (or forwarded-header-bearing) requests into a `relay` principal; transport and WS upgrade enforce a mobile-only allowlist for that principal. Existing local clients still resolve to `local`.

**Tech Stack:** TypeScript, Node `http`/`net`, Jest, existing gateway auth/transport/WS hub.

**Spec:** `docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §3.1 / §14–15.

## Global Constraints

- Marker header is exactly `x-mafw-tunnel`; secret is 32 random bytes hex; never persisted or logged.
- Terminator listens on `127.0.0.1` only; never `0.0.0.0`.
- Quick Tunnel must target the terminator port, never `:3000` directly.
- A valid device token through the tunnel stays `human`; only credential-less tunneled requests become `relay`.
- No new npm dependencies.
- Commits use ASCII messages; run gateway tests with `--runInBand` and typecheck with `npx tsc --noEmit -p tsconfig.json`.

## Review Focus

- A client-supplied `x-mafw-tunnel` must be stripped by the terminator and must never grant `local` or `relay` on its own.
- WebSocket upgrades must pass through the terminator, not just plain HTTP.
- A device token + tunnel marker must remain `human` (human-only mobile actions keep working).
- Pairing-code rate-limit exemption must apply only to the `local` principal, not every loopback socket.
- Relay must be denied terminal/voice/plugin WS, A2A, media upload, python, tools, cognition, file history, and admin routes.

---

### Task 1: Principal model + tunnel marker

**Files:**
- Modify: `gateway/src/core/auth.ts`
- Test: `gateway/tests/unit/core/tunnel-principal.test.ts`

**Interfaces:**
- Produces:
  - `export const TUNNEL_HEADER = 'x-mafw-tunnel'`
  - `export type PrincipalKind = 'human' | 'service' | 'local' | 'relay' | 'anonymous'`
  - `export type PrincipalMethod = 'human-token' | 'device-token' | 'api-token' | 'loopback' | 'tunnel' | 'none'`
  - `PrincipalResolveOpts.tunnelSecret?: string`
  - `export function isRelayPrincipal(p?: Principal): boolean`
  - `export function isLocalPrincipal(p?: Principal): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { TUNNEL_HEADER, resolvePrincipal } from '../../../src/core/auth';

const SECRET = 'a'.repeat(64);
const opts = { apiToken: 'svc', humanToken: 'human', tunnelSecret: SECRET };

it('marks marker-bearing requests as relay when no credential is present', () => {
  const p = resolvePrincipal({ remoteAddress: '127.0.0.1', headers: { [TUNNEL_HEADER]: SECRET } }, opts);
  expect(p).toEqual({ kind: 'relay', method: 'tunnel' });
});

it('keeps a valid device token human even through the tunnel', () => {
  const p = resolvePrincipal(
    { remoteAddress: '127.0.0.1', headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_x' } },
    { ...opts, verifyDeviceToken: () => ({ deviceId: 'd1' }) },
  );
  expect(p).toMatchObject({ kind: 'human', method: 'device-token', deviceId: 'd1' });
});

it('treats a forged marker plus Cloudflare forwarding headers as relay, never local', () => {
  const p = resolvePrincipal(
    { remoteAddress: '127.0.0.1', headers: { [TUNNEL_HEADER]: 'wrong', 'cf-connecting-ip': '1.2.3.4' } },
    opts,
  );
  expect(p).toEqual({ kind: 'relay', method: 'tunnel' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/core/tunnel-principal.test.ts --runInBand`
Expected: FAIL — `TUNNEL_HEADER` is not exported.

- [ ] **Step 3: Implement**

In `auth.ts`:
- Add `TUNNEL_HEADER`.
- Extend the two unions.
- In `resolvePrincipal`, after the `apiToken` check and before `fallbackPrincipal`:
  - `const marker = String(req.headers[TUNNEL_HEADER] || '').trim();`
  - `const tunneled = (marker && opts.tunnelSecret && constantTimeEqual(marker, opts.tunnelSecret)) || hasForwardingHeaders(req.headers);`
  - Return `{ kind: 'relay', method: 'tunnel' }` when `tunneled`.
- Add `function hasForwardingHeaders(headers)` returning true when `cf-connecting-ip` is present (Cloudflare Tunnel’s fail-closed hint).
- Add the two helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/core/tunnel-principal.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/auth.ts gateway/tests/unit/core/tunnel-principal.test.ts
git commit -m "feat(auth): add relay principal for tunneled requests"
```

---

### Task 2: Loopback tunnel terminator

**Files:**
- Create: `gateway/src/mobile/tunnel-terminator.ts`
- Test: `gateway/tests/unit/mobile/tunnel-terminator.test.ts`

**Interfaces:**
- Produces:
  - `export function newTunnelSecret(): string` (32 random bytes hex)
  - `export interface TunnelTerminatorOptions { secret: string; targetPort: number; targetHost?: string; listenHost?: string; listenPort?: number; }`
  - `export interface TunnelTerminator { start(): Promise<number>; stop(): Promise<void>; port(): number | null; }`
  - `export function createTunnelTerminator(opts: TunnelTerminatorOptions): TunnelTerminator`

- [ ] **Step 1: Write the failing test**

Use a real target `http.createServer` on `127.0.0.1:0` that records `req.headers[TUNNEL_HEADER]` and echoes `{marker, path}`. Start the terminator with `listenPort: 0`, send:

```ts
const res = await fetch(`http://127.0.0.1:${port}/api/presence?x=1`, {
  headers: { [TUNNEL_HEADER]: 'client-forged' },
});
expect(await res.json()).toEqual({ marker: SECRET, path: '/api/presence?x=1' });
```

Also assert:
- The target receives the marker exactly once (forged value replaced).
- A second test upgrades a WebSocket through the terminator to a target `upgrade` handler and exchanges one message.
- A third test points the terminator at a closed port and expects HTTP 502.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/mobile/tunnel-terminator.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `newTunnelSecret()` uses `crypto.randomBytes(32).toString('hex')`.
- `start()` creates `http.createServer` on `listenHost ?? '127.0.0.1'`, `listenPort ?? 3001`; resolves the bound port.
- Request handler clones headers, deletes any existing `TUNNEL_HEADER` (case-insensitive), sets the real secret, then `http.request({ host: targetHost ?? '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers })`; pipe both ways; on upstream error write 502 JSON.
- `server.on('upgrade')`: same header rewrite; issue `http.request` with the upgrade headers; on `upgrade` write the 101 status line and headers to the client socket, then pipe `head`/sockets both ways.
- Track sockets and destroy them in `stop()`; `port()` returns the bound port or null.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/mobile/tunnel-terminator.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mobile/tunnel-terminator.ts gateway/tests/unit/mobile/tunnel-terminator.test.ts
git commit -m "feat(mobile): add loopback tunnel terminator"
```

---

### Task 3: Relay HTTP allowlist

**Files:**
- Create: `gateway/src/http/relay-allowlist.ts`
- Test: `gateway/tests/unit/http/relay-allowlist.test.ts`

**Interfaces:**
- Produces: `export function isRelayAllowed(method: string, pathname: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
expect(isRelayAllowed('GET', '/api/presence')).toBe(true);
expect(isRelayAllowed('POST', '/api/chat/enriched')).toBe(true);
expect(isRelayAllowed('GET', '/api/ws')).toBe(true);
expect(isRelayAllowed('POST', '/api/mobile/pairing/verify')).toBe(true);
expect(isRelayAllowed('GET', '/api/mobile/media/tasks/t1/ask')).toBe(true);
expect(isRelayAllowed('POST', '/a2a')).toBe(false);
expect(isRelayAllowed('GET', '/api/terminal/sessions')).toBe(false);
expect(isRelayAllowed('POST', '/api/python/execute')).toBe(false);
expect(isRelayAllowed('POST', '/api/tools/execute')).toBe(false);
expect(isRelayAllowed('POST', '/api/cognition/gate')).toBe(false);
expect(isRelayAllowed('POST', '/api/media/upload')).toBe(false);
expect(isRelayAllowed('POST', '/api/mobile/pairing-code')).toBe(false);
expect(isRelayAllowed('POST', '/api/mobile/remote-access')).toBe(false);
expect(isRelayAllowed('GET', '/dashboard')).toBe(false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/http/relay-allowlist.test.ts --runInBand`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- Deny list first (exact/prefix): `/api/mobile/pairing-code`, `/api/mobile/remote-access`, `/api/mobile/tts`, `/api/media/`, `/api/terminal`, `/api/python`, `/api/tools`, `/api/cognition`, `/api/mcp`, `/api/plugins`, `/api/file-history`, `/api/config`, `/api/human-token`, `/api/devices`, `/a2a`, `/dashboard`, `/register`, `/control`.
- Allow list: `/health` (GET), `/api/presence`, `/api/projects`, `/api/sessions`, `/api/session`, `/api/chat/`, `/api/memory/search`, `/api/memory/energy-distribution`, `/api/pods`, `/api/goals`, `/api/approvals`, `/api/triage`, `/api/events/replay`, `/api/mobile/`, `/api/tts/voices`, `/api/ws`.
- `/api/tts/voices` must be checked before the `/api/tts` denial; `/api/mobile/pairing/verify` must remain allowed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/http/relay-allowlist.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/http/relay-allowlist.ts gateway/tests/unit/http/relay-allowlist.test.ts
git commit -m "feat(http): define relay route allowlist"
```

---

### Task 4: Transport enforces relay principal

**Files:**
- Modify: `gateway/src/http/transport.ts`
- Modify: `gateway/src/routes/registry-dispatch.ts`
- Test: `gateway/tests/unit/http/relay-transport.test.ts`

**Interfaces:**
- Consumes: `TUNNEL_HEADER`, `resolvePrincipal`, `isRelayAllowed`.
- Produces: `TransportDeps.tunnelSecret?: string`.

- [ ] **Step 1: Write the failing test**

Drive `createRequestListener` with the fake req/res harness from `principal-auth.test.ts`:

```ts
const deps = { ...baseDeps, tunnelSecret: 'a'.repeat(64), apiToken: () => 'svc' };
const listener = createRequestListener(deps as TransportDeps);

it('allows relay only on the mobile allowlist', async () => {
  const { res, rec } = fakeRes();
  await listener(fakeReq({ method: 'GET', url: '/api/presence', headers: { [TUNNEL_HEADER]: SECRET } }), res);
  expect(rec.status).toBe(200);
});

it('denies relay on desktop-only routes', async () => {
  for (const url of ['/a2a', '/api/terminal/sessions', '/api/python/execute', '/api/tools/execute']) {
    const { res, rec } = fakeRes();
    await listener(fakeReq({ method: 'POST', url, headers: { [TUNNEL_HEADER]: SECRET } }), res);
    expect(rec.status).toBe(403);
  }
});

it('keeps a real local request local', async () => {
  const { res, rec } = fakeRes();
  await listener(fakeReq({ method: 'GET', url: '/dashboard', remoteAddress: '127.0.0.1' }), res);
  expect(rec.status).not.toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/http/relay-transport.test.ts --runInBand`
Expected: FAIL — relay reaches desktop-only routes / deps type lacks `tunnelSecret`.

- [ ] **Step 3: Implement**

- `TransportDeps` gains `tunnelSecret?: string`.
- Pass `tunnelSecret` into `resolvePrincipal`.
- Compute `const isLocal = principal.kind === 'local';` and replace the raw `isLoopback` variable in this file with `isLocal` (fileHistory, `/a2a`, artifact, media branches).
- After the schema-epoch block and before `dispatchAuthorized`, add:
  ```ts
  if (principal.kind === 'relay' && !isRelayAllowed(req.method || 'GET', pathname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorBody('forbidden', API_ERROR_CODES.forbidden)));
    return;
  }
  ```
- In `registry-dispatch.ts`, include `'relay'` in `principalAllowed`, but skip the `authorizeRequest` loopback fallback when `kind === 'relay'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/http/relay-transport.test.ts tests/unit/http/principal-auth.test.ts tests/unit/http/transport.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/http/transport.ts gateway/src/routes/registry-dispatch.ts gateway/tests/unit/http/relay-transport.test.ts
git commit -m "feat(http): enforce relay allowlist in transport"
```

---

### Task 5: WS upgrade gates

**Files:**
- Modify: `gateway/src/http/ws-upgrade.ts`
- Test: `gateway/tests/unit/http/relay-ws-upgrade.test.ts`

**Interfaces:**
- Produces: `WsHubDeps.tunnelSecret?: string`.

- [ ] **Step 1: Write the failing test**

Using the fake-socket harness from `ws-upgrade.test.ts`:

```ts
it('allows /api/ws for relay', () => {
  hub.emitUpgrade(fakeReq('/api/ws', { [TUNNEL_HEADER]: SECRET }));
  expect(socket.written).not.toContain('401');
});

it('denies terminal/voice/plugin WS for relay', () => {
  for (const url of ['/api/terminal/sessions/t1/connect?ticket=x', '/voice', '/plugins/demo/ws']) {
    hub.emitUpgrade(fakeReq(url, { [TUNNEL_HEADER]: SECRET }));
    expect(socket.destroyed).toBe(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/http/relay-ws-upgrade.test.ts --runInBand`
Expected: FAIL — relay reaches terminal/plugin branches.

- [ ] **Step 3: Implement**

- Add `tunnelSecret?: string` to `WsHubDeps`; pass it into `resolveUpgradePrincipal`.
- Resolve the principal once at the top of the `server.on('upgrade')` handler.
- Voice: if `principal.kind === 'relay'`, write 403 and destroy.
- Terminal: replace `!isLoopbackAddr(rawAddr)` with `principal.kind !== 'local'`.
- Plugin WS: if `principal.kind === 'relay'`, write 403 and destroy before `handlePluginWsUpgrade`.
- `/api/ws`: keep the existing anonymous check; relay is allowed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/http/relay-ws-upgrade.test.ts tests/unit/http/ws-upgrade.test.ts tests/unit/http/principal-auth.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/http/ws-upgrade.ts gateway/tests/unit/http/relay-ws-upgrade.test.ts
git commit -m "feat(http): gate relay websocket upgrades"
```

---

### Task 6: Pairing-code rate limit uses local principal

**Files:**
- Modify: `gateway/src/mobile/pairing.ts`
- Modify: `gateway/src/routes/devices-mobile.ts`
- Test: `gateway/tests/unit/mobile/pairing-local-flag.test.ts`

**Interfaces:**
- Produces: `generatePairingCode(ip: string, opts?: { local?: boolean })`.
- Consumes: `isLocalPrincipal(req)`.

- [ ] **Step 1: Write the failing test**

```ts
it('does not exempt a relayed caller from the rate limit', () => {
  service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', rateLimit: 1 });
  expect(() => service.generatePairingCode('127.0.0.1', { local: false })).not.toThrow();
  expect(() => service.generatePairingCode('127.0.0.1', { local: false })).toThrow(/rate/i);
});

it('still exempts a true local caller', () => {
  service = new PairingService({ apiToken: 'x', tailscaleUrl: 'http://pc:3000', rateLimit: 1 });
  for (let i = 0; i < 5; i++) {
    expect(() => service.generatePairingCode('127.0.0.1', { local: true })).not.toThrow();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/mobile/pairing-local-flag.test.ts --runInBand`
Expected: FAIL — second argument ignored; relayed caller is exempt.

- [ ] **Step 3: Implement**

- `generatePairingCode(ip, opts)` computes `const local = opts?.local ?? isLoopbackAddr(ip);` and only skips the rate limit when `local`.
- In `devices-mobile.ts` pairing-code handler, call `generatePairingCode(ip, { local: isLocalPrincipal(req) })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/mobile/pairing-local-flag.test.ts tests/unit/mobile/pairing-v2.test.ts tests/unit/routes/devices-mobile-wiring.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mobile/pairing.ts gateway/src/routes/devices-mobile.ts gateway/tests/unit/mobile/pairing-local-flag.test.ts
git commit -m "fix(mobile): rate-limit relayed pairing-code requests"
```

---

### Task 7: Wire terminator + secret into the kernel

**Files:**
- Modify: `gateway/src/mobile/remote-access.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/mobile/remote-access-terminator-port.test.ts`

**Interfaces:**
- Consumes: `createTunnelTerminator`, `newTunnelSecret`.
- Produces: `RemoteAccessOptions.tunnelPort?: number`.

- [ ] **Step 1: Write the failing test**

```ts
it('spawns cloudflared against the terminator port, not 3000', async () => {
  const args: string[] = [];
  const service = new RemoteAccessService({
    port: 3000,
    tunnelPort: 3101,
    onUrl: () => {},
    spawnImpl: (_cmd, a) => { args.push(...a); return new FakeChild(); },
  });
  const starting = service.start();
  child.stderr.emit('data', 'https://x.trycloudflare.com');
  await starting;
  expect(args).toContain('http://127.0.0.1:3101');
  await service.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/mobile/remote-access-terminator-port.test.ts --runInBand`
Expected: FAIL — args still contain `http://127.0.0.1:3000`.

- [ ] **Step 3: Implement**

- `RemoteAccessOptions.tunnelPort?: number` (default 3001); `spawnTunnel` uses `http://127.0.0.1:${this.tunnelPort}`.
- In `kernel.ts`:
  - Fields `private tunnelSecret = ''; private tunnelTerminator?: TunnelTerminator;`.
  - In `initServices` after `PairingService` construction: `this.tunnelSecret = newTunnelSecret(); this.tunnelTerminator = createTunnelTerminator({ secret: this.tunnelSecret, targetPort: this.apiPort, listenPort: readTunnelPort() }); await this.tunnelTerminator.start();` where `readTunnelPort()` reads `MAFW_TUNNEL_TERMINATOR_PORT` and defaults to 3001.
  - Pass `tunnelSecret: this.tunnelSecret` in `httpTransportDeps()` and `createWsHub(...)`.
  - Pass `tunnelPort: this.tunnelTerminator?.port() ?? 3001` to `new RemoteAccessService(...)`.
  - In `stop()`, `void this.tunnelTerminator?.stop();`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/mobile/remote-access-terminator-port.test.ts tests/unit/mobile/remote-access.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mobile/remote-access.ts gateway/src/kernel.ts gateway/tests/unit/mobile/remote-access-terminator-port.test.ts
git commit -m "feat(mobile): route quick tunnel through the terminator"
```

---

### Task 8: Regression, docs, smoke

**Files:**
- Modify: `docs/architecture/mobile.md` (§7.15 / §7.16)
- Modify: `docs/guides/operations.md`
- Create: `docs/releases/2026-11-18-mobile-tunnel-trust-m0.md`

- [ ] **Step 1: Run the broad gateway suites**

Run: `npx jest tests/unit/core tests/unit/http tests/unit/mobile tests/unit/routes --runInBand`
Expected: all PASS.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Smoke Quick Tunnel**

```bash
node bin/mafw.js pair --remote
# copy the tunnel URL
curl "https://<tunnel>/health"                      # 200
curl -H "x-mafw-tunnel: forged" "https://<tunnel>/api/terminal/sessions"  # 403
curl "https://<tunnel>/a2a" -X POST -d '{}'         # 403
# pair with the printed nonce, then:
curl -H "Authorization: Bearer dev_..." "https://<tunnel>/api/presence"   # 200
node bin/mafw.js pair --stop
```

- [ ] **Step 4: Write docs + release note**

- `mobile.md`: Quick Tunnel now targets the loopback terminator; relayed requests are `relay` principal and mobile-only; loopback trust is unchanged for real local clients.
- `operations.md`: mention `MAFW_TUNNEL_TERMINATOR_PORT` (default 3001) is loopback-only.
- Release note: commit hash, test counts, smoke result, and the security finding (tunneled requests previously resolved as `local`).

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/mobile.md docs/guides/operations.md docs/releases/2026-11-18-mobile-tunnel-trust-m0.md
git commit -m "docs(mobile): record tunnel trust boundary fix"
```

---

## Self-Review

- Spec coverage: M0 §3.1 (principal, marker, allowlist, Quick Tunnel), §14 (loopback trust), §15 (Quick Tunnel compatibility) are covered by Tasks 1–8.
- No new dependencies; terminator uses Node `http`.
- Type names are consistent: `TUNNEL_HEADER`, `relay`, `tunnel`, `tunnelSecret`, `tunnelPort`, `isRelayAllowed`.
- Review Focus items each have a test in Tasks 1–6.
