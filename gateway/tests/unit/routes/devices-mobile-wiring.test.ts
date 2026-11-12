// Phase D1 Task H2: devices + mobile registry wiring — eight legacy branches.
// Legacy used one regex per arm with `req.method === '…'` arming; the registry
// splits methods structurally. Assertions pin the SECURITY-relevant quirks:
// apiTokenHash is always computed server-side (sha256 → 16 hex), the presented
// token is the device's FCM push token (persisted as fcmToken; the gateway
// bearer token never enters the device record), and the pairing gates keep
// their exact 503 / 400 / 429 status + message shapes.
import type { IncomingMessage, ServerResponse } from 'http';
import { createHash } from 'crypto';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachDevicesMobileRoutes, type DevicesMobileRouteDeps } from '../../../src/routes/devices-mobile';

function fakeReq(opts: { method: string; url: string; body?: string; socket?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: opts.socket ?? '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string; headers: Record<string, unknown> } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', headers: {} as Record<string, unknown> };
  out.res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
    },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, get headers() { return out.headers; } } as any;
}

const sha = (token: string, len: number) => createHash('sha256').update(token).digest('hex').slice(0, len);

function pushGateway() {
  const registered: any[] = [];
  const removed: string[] = [];
  const issued: any[] = [];
  return {
    registered,
    removed,
    issued,
    gw: {
      registerDevice: (input: any) => { registered.push(input); return { ...input, lastSeen: '2026-11-10T00:00:00Z' }; },
      listDevices: () => [{ id: 'dev-1' }, { id: 'dev-2' }],
      listPublicDevices: () => [{ id: 'dev-1' }, { id: 'dev-2' }],
      removeDevice: (id: string) => { removed.push(id); return id === 'dev-1'; },
      getDevice: () => undefined,
      issueDeviceToken: (deviceId: string, token: string, opts: any) => {
        issued.push({ deviceId, token, opts });
        return { id: deviceId, deviceTokenHash: 'hash', tokenIssuedAt: '2026-11-12T00:00:00Z' };
      },
    } as any,
  };
}

function pairingService() {
  const codes: string[] = [];
  const nonces: string[] = [];
  return {
    codes,
    nonces,
    svc: {
      generatePairingCode: (ip: string) => { codes.push(ip); return { url: `http://127.0.0.1:3000/pair?n=${ip}` }; },
      consumeNonce: (nonce: string) => { nonces.push(nonce); return nonce === 'good'; },
    } as any,
  };
}

function setup(over: Partial<DevicesMobileRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachDevicesMobileRoutes(registry, { pushGateway: () => undefined, pairingService: () => undefined, ...over });
  return registry;
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('devices + mobile registry wiring (D1 Task H2)', () => {
  it('binds all eight catalog routes (method split replaces the armed ifs)', () => {
    const registry = setup();
    const bindings: Array<[string, string, string]> = [
      ['POST', '/api/devices', 'devices.register'],
      ['GET', '/api/devices', 'devices.list'],
      ['DELETE', '/api/devices/dev-1', 'devices.delete'],
      ['GET', '/api/mobile/devices', 'mobile.devicesList'],
      ['DELETE', '/api/mobile/devices/dev-1', 'mobile.devicesDelete'],
      ['POST', '/api/mobile/devices/register', 'mobile.devicesRegister'],
      ['GET', '/api/mobile/pairing-code', 'mobile.pairingCode'],
      ['POST', '/api/mobile/pairing/verify', 'mobile.pairingVerify'],
    ];
    for (const [method, url, op] of bindings) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
  });

  it('devices.register hashes the token server-side and returns the device entry', async () => {
    const pg = pushGateway();
    const registry = setup({ pushGateway: () => pg.gw });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/devices')!(
      fakeReq({ method: 'POST', url: '/api/devices', body: JSON.stringify({ id: 'dev-9', fcmToken: 'fcm', platform: 'android', token: 'secret' }) }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(pg.registered[0]).toEqual({ id: 'dev-9', fcmToken: 'fcm', platform: 'android', apiTokenHash: sha('secret', 16) });
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, device: { id: 'dev-9' } });
  });

  it('devices.register keeps the 400 field-list gate and the 500 catch', async () => {
    const registry = setup();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/devices')!(
      fakeReq({ method: 'POST', url: '/api/devices', body: JSON.stringify({ id: 'dev-9', platform: 'android' }) }),
      r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('id, fcmToken, platform, token required');

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/devices')!(fakeReq({ method: 'POST', url: '/api/devices', body: 'not-json' }), r.res);
    expect(r.status).toBe(500);
  });

  it('list returns {devices} or [] when no push gateway is configured', async () => {
    const pg = pushGateway();
    let r = fakeRes();
    await handlerFor(setup({ pushGateway: () => pg.gw }), 'GET', '/api/devices')!(fakeReq({ method: 'GET', url: '/api/devices' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ devices: [{ id: 'dev-1' }, { id: 'dev-2' }] });

    r = fakeRes();
    await handlerFor(setup(), 'GET', '/api/mobile/devices')!(fakeReq({ method: 'GET', url: '/api/mobile/devices' }), r.res);
    expect(JSON.parse(r.body)).toEqual({ devices: [] });
  });

  it('delete is ok-200 / not-found-404 with the legacy body + header', async () => {
    const pg = pushGateway();
    const registry = setup({ pushGateway: () => pg.gw });
    let r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/devices/dev-1')!(fakeReq({ method: 'DELETE', url: '/api/devices/dev-1' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(r.headers['Content-Type']).toBe('application/json');

    r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/mobile/devices/dev-2')!(
      fakeReq({ method: 'DELETE', url: '/api/mobile/devices/dev-2' }), r.res,
    );
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: 'device not found' });
    expect(pg.removed).toEqual(['dev-1', 'dev-2']);
  });

  it('mobile registration maps {token,platform,deviceName} onto the push shape (32/16 hex, FCM token kept)', async () => {
    const pg = pushGateway();
    const registry = setup({ pushGateway: () => pg.gw });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mobile/devices/register')!(
      fakeReq({ method: 'POST', url: '/api/mobile/devices/register', body: JSON.stringify({ token: 'tok', platform: 'android', deviceName: 'pixel' }) }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(pg.registered[0]).toEqual({
      id: sha('tok', 32),
      fcmToken: 'tok', // 客户端上报的 FCM push token（不是网关凭据）
      platform: 'android',
      apiTokenHash: sha('tok', 16),
    });
  });

  it('pairing-code is 503 without a service, 200 with the code, 429 on rate limit', async () => {
    let r = fakeRes();
    await handlerFor(setup(), 'GET', '/api/mobile/pairing-code')!(fakeReq({ method: 'GET', url: '/api/mobile/pairing-code' }), r.res);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('Pairing service not available');

    const ps = pairingService();
    r = fakeRes();
    await handlerFor(setup({ pairingService: () => ps.svc }), 'GET', '/api/mobile/pairing-code')!(
      fakeReq({ method: 'GET', url: '/api/mobile/pairing-code', socket: '192.168.1.9' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ url: 'http://127.0.0.1:3000/pair?n=192.168.1.9' });
    expect(ps.codes).toEqual(['192.168.1.9']);

    const limited = { generatePairingCode: () => { throw new Error('rate limit exceeded'); } } as any;
    r = fakeRes();
    await handlerFor(setup({ pairingService: () => limited }), 'GET', '/api/mobile/pairing-code')!(
      fakeReq({ method: 'GET', url: '/api/mobile/pairing-code' }), r.res,
    );
    expect(r.status).toBe(429);
    expect(JSON.parse(r.body).error).toBe('rate limit exceeded');
  });

  it('pairing/verify consumes the nonce and issues a device credential (v2)', async () => {
    const ps = pairingService();
    const pg = pushGateway();
    const registry = setup({ pairingService: () => ps.svc, pushGateway: () => pg.gw });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mobile/pairing/verify')!(
      fakeReq({ method: 'POST', url: '/api/mobile/pairing/verify', body: JSON.stringify({}) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('nonce required');

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mobile/pairing/verify')!(
      fakeReq({ method: 'POST', url: '/api/mobile/pairing/verify', body: JSON.stringify({ nonce: 'stale' }) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('Invalid or expired pairing nonce');

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mobile/pairing/verify')!(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/pairing/verify',
        body: JSON.stringify({ nonce: 'good', deviceId: 'phone-1', platform: 'android' }),
      }), r.res,
    );
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.deviceId).toBe('phone-1');
    expect(body.token).toMatch(/^dev_/);
    expect(pg.issued[0]).toEqual({
      deviceId: 'phone-1',
      token: body.token,
      opts: { platform: 'android', deviceName: undefined },
    });
    expect(ps.nonces).toEqual(['stale', 'good']);
  });
});
