/**
 * E5a-3 — devices/mobile routes: pairing v2 credential issuance, sanitized
 * listings, principal-based registration ids, revocation on delete, and the
 * narrow unauthenticated `POST /api/mobile/pairing/verify` exemption.
 *
 * Route-level tests drive the registry handlers directly (principal injected
 * the way the transport does); the last block drives the real transport +
 * `dispatchAuthorized` so the exemption and the device→human mapping are
 * pinned end to end.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachDevicesMobileRoutes } from '../../../src/routes/devices-mobile';
import { DeviceStore } from '../../../src/mobile/device-store';
import { PushGateway } from '../../../src/mobile/push-gateway';
import { PairingService } from '../../../src/mobile/pairing';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';
import { dispatchAuthorized } from '../../../src/routes/registry-dispatch';
import { humanOnlyDenied, isHumanPrincipal } from '../../../src/core/auth';

const REMOTE = '203.0.113.9';
const SERVICE = 'shared-service-token';

const sha = (value: string, len: number) => createHash('sha256').update(value).digest('hex').slice(0, len);

function tmpFile(name = 'mobile-devices.json'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-devices-routes-'));
  return path.join(dir, name);
}

function fakeReq(opts: {
  method: string;
  url: string;
  body?: string;
  socket?: string;
  headers?: Record<string, string>;
  principal?: unknown;
}): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req: any = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: opts.socket ?? '127.0.0.1' },
    headers: opts.headers ?? {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  if (opts.principal !== undefined) req.mafwPrincipal = opts.principal;
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string; headers: Record<string, unknown> } {
  const out: any = { status: 200, body: '', headers: {} };
  out.res = {
    headersSent: false,
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
      return out.res;
    },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); return out.res; },
    setHeader: () => {},
    write: () => true,
  } as unknown as ServerResponse;
  return out;
}

function harness() {
  const file = tmpFile();
  const store = new DeviceStore(file);
  const gateway = new PushGateway(store);
  const pairing = new PairingService({ apiToken: SERVICE, tailscaleUrl: 'http://pc.tailnet.ts.net:3000' });
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachDevicesMobileRoutes(registry, {
    pushGateway: () => gateway,
    pairingService: () => pairing,
  });
  const handlerFor = (method: string, url: string) => {
    const m = registry.match(method as never, url);
    if (!m?.def.handler) throw new Error(`no handler for ${method} ${url}`);
    return (req: IncomingMessage, res: ServerResponse) => m.def.handler!(req, res, m.params);
  };
  return { file, store, gateway, pairing, registry, handlerFor };
}

async function verifyPairing(
  h: ReturnType<typeof harness>,
  body: Record<string, unknown>,
  principal?: unknown,
) {
  const r = fakeRes();
  await h.handlerFor('POST', '/api/mobile/pairing/verify')(
    fakeReq({ method: 'POST', url: '/api/mobile/pairing/verify', body: JSON.stringify(body), principal }),
    r.res,
  );
  return r;
}

describe('pairing v2 issues a per-device token (routes)', () => {
  it('consumes the nonce, stores sha256(token) and returns {ok,token,deviceId}', async () => {
    const h = harness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;

    const r = await verifyPairing(h, { nonce, deviceId: 'phone-1', platform: 'android', deviceName: 'Pixel' });

    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body).toMatchObject({ ok: true, deviceId: 'phone-1' });
    expect(body.token).toMatch(/^dev_[A-Za-z0-9_-]{40,}$/);

    expect(h.store.verifyCredential(body.token)?.id).toBe('phone-1');
    const entry = h.store.get('phone-1')!;
    expect(entry.deviceTokenHash).toBe(createHash('sha256').update(body.token).digest('hex'));
    expect(entry.platform).toBe('android');
    expect(entry.deviceName).toBe('Pixel');
    expect(entry.tokenIssuedAt).toBeTruthy();

    // Plaintext never lands on disk.
    const raw = fs.readFileSync(h.file, 'utf8');
    expect(raw).not.toContain(body.token);

    // Nonce is single-use.
    expect(h.pairing.consumeNonce(nonce)).toBe(false);
  });

  it('generates a deviceId when the client does not send one', async () => {
    const h = harness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;

    const r = await verifyPairing(h, { nonce, platform: 'ios' });

    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.deviceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(h.store.verifyCredential(body.token)?.id).toBe(body.deviceId);
  });

  it('keeps the 400 invalid-nonce gate and never leaks a token', async () => {
    const h = harness();
    const r = await verifyPairing(h, { nonce: 'stale' });

    expect(r.status).toBe(400);
    const body = JSON.parse(r.body);
    expect(body).toEqual({ error: 'Invalid or expired pairing nonce' });
    expect(JSON.stringify(body)).not.toContain('dev_');
  });

  it('is 503 when no push gateway is configured and does not burn the nonce', async () => {
    const file = tmpFile();
    const pairing = new PairingService({ apiToken: SERVICE, tailscaleUrl: 'http://pc:3000' });
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachDevicesMobileRoutes(registry, { pushGateway: () => undefined, pairingService: () => pairing });
    const handler = registry.match('POST' as never, '/api/mobile/pairing/verify')!.def.handler!;
    const nonce = new URL(pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;

    const r = fakeRes();
    await handler(fakeReq({ method: 'POST', url: '/api/mobile/pairing/verify', body: JSON.stringify({ nonce }) }), r.res);

    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('Push gateway not available');
    expect(pairing.consumeNonce(nonce)).toBe(true);
    void file;
  });
});

describe('device registration uses the device principal (routes)', () => {
  it('mobile.devicesRegister prefers principal.deviceId over the FCM-derived id', async () => {
    const h = harness();
    const r = fakeRes();
    await h.handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        body: JSON.stringify({ token: 'fcm-token', platform: 'android', deviceName: 'Pixel' }),
        principal: { kind: 'human', method: 'device-token', deviceId: 'phone-1' },
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    const device = JSON.parse(r.body).device;
    expect(device.id).toBe('phone-1');
    expect(h.gateway.getDevice('phone-1')!.fcmToken).toBe('fcm-token');
  });

  it('mobile.devicesRegister keeps the legacy FCM-hash id without a principal', async () => {
    const h = harness();
    const r = fakeRes();
    await h.handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        body: JSON.stringify({ token: 'fcm-token', platform: 'android' }),
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).device.id).toBe(sha('fcm-token', 32));
  });

  it('devices.register prefers principal.deviceId but keeps the legacy body id otherwise', async () => {
    const h = harness();
    const body = JSON.stringify({ id: 'body-id', fcmToken: 'fcm', platform: 'android', token: 'seed' });

    let r = fakeRes();
    await h.handlerFor('POST', '/api/devices')(
      fakeReq({
        method: 'POST',
        url: '/api/devices',
        body,
        principal: { kind: 'human', method: 'device-token', deviceId: 'phone-1' },
      }),
      r.res,
    );
    expect(JSON.parse(r.body).device.id).toBe('phone-1');

    r = fakeRes();
    await h.handlerFor('POST', '/api/devices')(fakeReq({ method: 'POST', url: '/api/devices', body }), r.res);
    expect(JSON.parse(r.body).device.id).toBe('body-id');
  });
});

describe('device listing is sanitized (routes)', () => {
  it('never returns deviceTokenHash / apiTokenHash', async () => {
    const h = harness();
    h.gateway.registerDevice({ id: 'legacy-1', fcmToken: 'fcm', platform: 'android', apiTokenHash: 'push-hash' });
    h.gateway.issueDeviceToken('phone-1', 'dev_list_token_abcdefghijklmnop', {
      platform: 'android',
      deviceName: 'Pixel',
    });

    for (const [method, url] of [['GET', '/api/mobile/devices'], ['GET', '/api/devices']] as const) {
      const r = fakeRes();
      await h.handlerFor(method, url)(fakeReq({ method, url }), r.res);
      expect(r.status).toBe(200);
      const devices = JSON.parse(r.body).devices;
      expect(devices).toHaveLength(2);
      for (const device of devices) {
        expect(device).not.toHaveProperty('deviceTokenHash');
        expect(device).not.toHaveProperty('apiTokenHash');
      }
    }
  });

  it('still lists a legacy record that has no credential hash', async () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      devices: [{ id: 'legacy-1', fcmToken: 'fcm', platform: 'android', lastSeen: '2026-01-01T00:00:00.000Z' }],
    }), 'utf8');

    const store = new DeviceStore(file);
    const gateway = new PushGateway(store);
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachDevicesMobileRoutes(registry, { pushGateway: () => gateway, pairingService: () => undefined });
    const handler = registry.match('GET' as never, '/api/mobile/devices')!.def.handler!;

    const r = fakeRes();
    await handler(fakeReq({ method: 'GET', url: '/api/mobile/devices' }), r.res);

    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).devices).toEqual([{
      id: 'legacy-1',
      fcmToken: 'fcm',
      platform: 'android',
      lastSeen: '2026-01-01T00:00:00.000Z',
    }]);
  });
});

describe('deleting a device revokes its credential (routes)', () => {
  it('DELETE removes the entry so the token no longer verifies', async () => {
    const h = harness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
    const issued = JSON.parse((await verifyPairing(h, { nonce, deviceId: 'phone-1', platform: 'android' })).body);

    const r = fakeRes();
    await h.handlerFor('DELETE', '/api/mobile/devices/phone-1')(
      fakeReq({ method: 'DELETE', url: '/api/mobile/devices/phone-1' }),
      r.res,
    );

    expect(r.status).toBe(200);
    expect(h.store.verifyCredential(issued.token)).toBeNull();
  });
});

describe('pairing verify hardening (F5/F8 routes)', () => {
  function freshNonce(h: ReturnType<typeof harness>): string {
    return new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
  }

  it('409 device_already_paired without rotate:true; nonce is not consumed (F5)', async () => {
    const h = harness();
    const first = JSON.parse((await verifyPairing(h, {
      nonce: freshNonce(h), deviceId: 'phone-1', platform: 'android',
    })).body);

    const nonce = freshNonce(h);
    const r = await verifyPairing(h, { nonce, deviceId: 'phone-1', platform: 'android' });

    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ error: 'device already paired', code: 'device_already_paired' });
    // Old credential untouched, nonce retryable.
    expect(h.store.verifyCredential(first.token)).not.toBeNull();
    expect(h.pairing.consumeNonce(nonce)).toBe(true);
  });

  it('rotate:true replaces the credential and invalidates the old token (F5)', async () => {
    const h = harness();
    const first = JSON.parse((await verifyPairing(h, {
      nonce: freshNonce(h), deviceId: 'phone-1', platform: 'android',
    })).body);

    const r = await verifyPairing(h, {
      nonce: freshNonce(h), deviceId: 'phone-1', platform: 'android', rotate: true,
    });

    expect(r.status).toBe(200);
    const rotated = JSON.parse(r.body);
    expect(rotated.token).not.toBe(first.token);
    expect(h.store.verifyCredential(first.token)).toBeNull();
    expect(h.store.verifyCredential(rotated.token)?.id).toBe('phone-1');
  });

  it('allows pairing a push-only device that has no credential yet (F5)', async () => {
    const h = harness();
    h.gateway.registerDevice({ id: 'phone-1', fcmToken: 'fcm', platform: 'android', apiTokenHash: 'h' });

    const r = await verifyPairing(h, { nonce: freshNonce(h), deviceId: 'phone-1', platform: 'android' });

    expect(r.status).toBe(200);
    expect(h.store.get('phone-1')!.fcmToken).toBe('fcm');
    expect(h.store.get('phone-1')!.deviceTokenHash).toBeTruthy();
  });

  it('rejects invalid / overlong device ids with 400 before consuming the nonce (F8)', async () => {
    const h = harness();

    for (const deviceId of ['a'.repeat(129), 'bad id', 'x/y']) {
      const nonce = freshNonce(h);
      const r = await verifyPairing(h, { nonce, deviceId, platform: 'android' });
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body).error).toMatch(/deviceId/i);
      expect(h.pairing.consumeNonce(nonce)).toBe(true);
    }
  });

  it('rejects overlong deviceName / platform with 400 (F8)', async () => {
    const h = harness();

    let r = await verifyPairing(h, {
      nonce: freshNonce(h), deviceId: 'phone-1', platform: 'android', deviceName: 'n'.repeat(101),
    });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/deviceName/i);

    r = await verifyPairing(h, {
      nonce: freshNonce(h), deviceId: 'phone-1', platform: 'p'.repeat(41),
    });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/platform/i);
  });

  it('preserves the existing platform when rotation omits it (F8)', async () => {
    const h = harness();
    await verifyPairing(h, { nonce: freshNonce(h), deviceId: 'phone-1', platform: 'android' });

    const r = await verifyPairing(h, { nonce: freshNonce(h), deviceId: 'phone-1', rotate: true });

    expect(r.status).toBe(200);
    expect(h.store.get('phone-1')!.platform).toBe('android');
  });

  it('defaults a first-time pairing without platform to unknown (F8)', async () => {
    const h = harness();
    const r = await verifyPairing(h, { nonce: freshNonce(h), deviceId: 'phone-1' });

    expect(r.status).toBe(200);
    expect(h.store.get('phone-1')!.platform).toBe('unknown');
  });
});

describe('registry dispatch requires the transport pairing flag (F6)', () => {
  it('401s a direct dispatch without mafwPairingVerify', async () => {
    const h = harness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
    const req = fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce }),
    });
    const r = fakeRes();

    const handled = await dispatchAuthorized({ registry: h.registry, apiToken: SERVICE }, req, r.res);

    expect(handled).toBe(true);
    expect(r.status).toBe(401);
    expect(h.pairing.consumeNonce(nonce)).toBe(true);
  });

  it('proceeds when the transport marked the request', async () => {
    const h = harness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
    const req: any = fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce, deviceId: 'phone-1', platform: 'android' }),
    });
    req.mafwPairingVerify = true;
    const r = fakeRes();

    const handled = await dispatchAuthorized({ registry: h.registry, apiToken: SERVICE }, req, r.res);

    expect(handled).toBe(true);
    expect(r.status).toBe(200);
    expect(h.store.verifyCredential(JSON.parse(r.body).token)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transport integration: the pairing-verify exemption + device → human mapping
// ---------------------------------------------------------------------------

function makeTransportDeps(registry: RouteRegistry): TransportDeps {
  return {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => SERVICE,
    humanToken: () => '',
    verifyDeviceToken: (token: string) => depsRef.pushGateway?.verifyDeviceToken(token) ?? null,
    dispatchAuthorized: (req, res, apiToken) => dispatchAuthorized({ registry, apiToken }, req, res),
    pluginWebWildcard: async () => false,
    fileHistory: async () => false,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: async () => ({ status: 200, body: {} }),
    register: {
      parseIntent: () => null,
      isUserDataDir: () => false,
      isSelectableProject: () => true,
      registeredProject: () => undefined,
      registerProject: () => undefined,
      setCurrentProject: () => undefined,
      persistRegistry: async () => undefined,
      broadcastProjectRegistered: () => undefined,
      hasRuntime: () => false,
      ensureManagerSession: async () => 'sid',
    },
    control: {
      patchState: async () => undefined,
      destroyAllSessions: async () => undefined,
      getActiveGoal: () => undefined,
      registeredProjects: () => new Map<string, { mafwDir: string }>().entries(),
      getGatewayDb: () => ({} as never),
      archiveGoal: async () => undefined,
    },
    health: {
      serveRunning: () => false,
      registeredProjectDirs: () => [],
      activeGoalIds: () => [],
      mediaConfigured: () => false,
      releaseFields: () => ({}),
    },
    proxyTarget: () => 'http://127.0.0.1:9',
    proxyHeaders: () => ({}),
  } as unknown as TransportDeps;
}

// The verifier closure needs the live gateway; set per test before requesting.
const depsRef: { pushGateway?: PushGateway } = {};

async function transportRequest(deps: TransportDeps, req: IncomingMessage) {
  const r = fakeRes();
  await createRequestListener(deps)(req, r.res);
  return r;
}

function integrationHarness() {
  const file = tmpFile();
  const store = new DeviceStore(file);
  const gateway = new PushGateway(store);
  depsRef.pushGateway = gateway;
  const pairing = new PairingService({ apiToken: SERVICE, tailscaleUrl: 'http://pc.tailnet.ts.net:3000' });
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachDevicesMobileRoutes(registry, { pushGateway: () => gateway, pairingService: () => pairing });
  registry.register({
    method: 'POST',
    path: '/api/__test/human-only',
    operationId: 'test.humanOnly',
    handler: async (req, res) => {
      if (!isHumanPrincipal((req as any).mafwPrincipal)) {
        const denied = humanOnlyDenied();
        res.writeHead(denied.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(denied.body));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, principal: (req as any).mafwPrincipal }));
    },
  });
  registry.register({
    method: 'POST',
    path: '/api/__test/service-ok',
    operationId: 'test.serviceOk',
    handler: async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
  });
  return { file, store, gateway, pairing, registry, deps: makeTransportDeps(registry) };
}

describe('transport integration: pairing verify exemption + device auth', () => {
  it('lets a remote unauthenticated client exchange a valid nonce for a token', async () => {
    const h = integrationHarness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;

    const r = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce, platform: 'android', deviceName: 'Pixel' }),
    }));

    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.token).toMatch(/^dev_/);
    expect(h.store.verifyCredential(body.token)).toBeTruthy();
  });

  it('returns 400 for an invalid nonce', async () => {
    const h = integrationHarness();

    const r = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce: 'nope' }),
    }));

    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'Invalid or expired pairing nonce' });
  });

  it('keeps every other anonymous remote route at 401', async () => {
    const h = integrationHarness();

    const r = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/human-only',
      socket: REMOTE,
      body: '{}',
    }));

    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toEqual({ error: 'unauthorized', code: 'unauthorized' });
  });

  it('lets a device token call a human-only route; a service token stays 403', async () => {
    const h = integrationHarness();
    const nonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
    const issued = JSON.parse((await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce, deviceId: 'phone-1', platform: 'android' }),
    }))).body);

    const humanCall = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/human-only',
      socket: REMOTE,
      headers: { authorization: `Bearer ${issued.token}` },
      body: '{}',
    }));
    expect(humanCall.status).toBe(200);
    expect(JSON.parse(humanCall.body).principal).toEqual({
      kind: 'human',
      method: 'device-token',
      deviceId: 'phone-1',
    });

    const serviceCall = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/human-only',
      socket: REMOTE,
      headers: { authorization: `Bearer ${SERVICE}` },
      body: '{}',
    }));
    expect(serviceCall.status).toBe(403);
    expect(JSON.parse(serviceCall.body).code).toBe('human_principal_required');
  });

  it('rejects an oversized content-length before dispatch with 413 (F2)', async () => {
    const h = integrationHarness();

    const r = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      headers: { 'content-length': '9000' },
      body: '',
    }));

    expect(r.status).toBe(413);
    expect(JSON.parse(r.body)).toEqual({ error: 'payload too large', code: 'payload_too_large' });
  });

  it('rejects an oversized chunked body at the route reader with 413 (F2)', async () => {
    const h = integrationHarness();

    const r = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      // No content-length: the capped reader must reject the streamed body.
      body: `{"nonce":"${'x'.repeat(9000)}"}`,
    }));

    expect(r.status).toBe(413);
    expect(JSON.parse(r.body)).toEqual({ error: 'payload too large', code: 'payload_too_large' });
  });

  it('does not apply the pairing body cap to other routes (F2)', async () => {
    const h = integrationHarness();

    const r = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/service-ok',
      socket: REMOTE,
      headers: { 'content-length': '9000', authorization: `Bearer ${SERVICE}` },
      body: '{}',
    }));

    expect(r.status).toBe(200);
  });

  it('rotation and deletion both invalidate the previous device token at the transport', async () => {    const h = integrationHarness();
    const firstNonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
    const first = JSON.parse((await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce: firstNonce, deviceId: 'phone-1', platform: 'android' }),
    }))).body);

    // Re-pair the same device → rotation.
    const secondNonce = new URL(h.pairing.generatePairingCode('127.0.0.1').url).searchParams.get('nonce')!;
    const second = JSON.parse((await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      socket: REMOTE,
      body: JSON.stringify({ nonce: secondNonce, deviceId: 'phone-1', platform: 'android', rotate: true }),
    }))).body);
    expect(second.token).not.toBe(first.token);

    const oldToken = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/human-only',
      socket: REMOTE,
      headers: { 'x-mafw-device-token': first.token },
      body: '{}',
    }));
    expect(oldToken.status).toBe(401);

    const newToken = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/human-only',
      socket: REMOTE,
      headers: { 'x-mafw-device-token': second.token },
      body: '{}',
    }));
    expect(newToken.status).toBe(200);

    h.gateway.removeDevice('phone-1');
    const afterDelete = await transportRequest(h.deps, fakeReq({
      method: 'POST',
      url: '/api/__test/human-only',
      socket: REMOTE,
      headers: { 'x-mafw-device-token': second.token },
      body: '{}',
    }));
    expect(afterDelete.status).toBe(401);
  });
});
