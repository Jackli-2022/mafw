/**
 * E1-10 设备 token 存储止血（spec §E1-10 / A13 部分）。
 *
 * 缺陷：`POST /api/mobile/devices/register` 把网关 bearer token 当 `fcmToken`
 * 明文写进 `~/.mafw/mobile-devices.json`；`apiTokenHash` 写了但从不校验。
 *
 * 契约：
 *  (a) 注册成功后磁盘 JSON 不出现原始 token（字段仍在、值为空）；有 apiTokenHash；
 *  (b) 提交的 token 与已配置网关 token 不一致 → 401 且不落盘；
 *  (c) 旧格式记录（只有 fcmToken、无 hash）仍能加载/列出，不崩。
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

const GW_TOKEN = 'gw-secret-token-abc123';
const sha = (value: string, len: number) => createHash('sha256').update(value).digest('hex').slice(0, len);

function fakeReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
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

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out as any;
}

function setup(opts: { file: string; apiToken?: () => string }) {
  const store = new DeviceStore(opts.file);
  const gateway = new PushGateway(store);
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachDevicesMobileRoutes(registry, {
    pushGateway: () => gateway,
    pairingService: () => undefined,
    apiToken: opts.apiToken ?? (() => GW_TOKEN),
  });
  const handlerFor = (method: string, url: string) => {
    const m = registry.match(method as never, url)!;
    return (req: IncomingMessage, res: ServerResponse) => m.def.handler!(req, res, m.params);
  };
  return { store, gateway, handlerFor };
}

function tmpStoreFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-device-store-'));
  return path.join(dir, 'mobile-devices.json');
}

describe('设备注册不持久化网关 token（E1-10 a/b）', () => {
  it('mobile 注册成功后磁盘 JSON 不含原始 token，且有 apiTokenHash', async () => {
    const file = tmpStoreFile();
    const { gateway, handlerFor } = setup({ file });
    const r = fakeRes();

    await handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        body: JSON.stringify({ token: GW_TOKEN, platform: 'android', deviceName: 'pixel' }),
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain(GW_TOKEN);

    const stored = JSON.parse(raw).devices[0];
    expect(stored.id).toBe(sha(GW_TOKEN, 32));
    expect(stored.apiTokenHash).toBe(sha(GW_TOKEN, 16));
    expect(stored.fcmToken).not.toBe(GW_TOKEN);
    expect(stored.fcmToken).toBe('');

    // 返回体（含 device）也不得回显原始 token。
    expect(r.body).not.toContain(GW_TOKEN);
    expect(gateway.listDevices()).toHaveLength(1);
  });

  it('legacy /api/devices 同样不持久化 body 里的 fcmToken/token 原文', async () => {
    const file = tmpStoreFile();
    const { handlerFor } = setup({ file });
    const r = fakeRes();

    await handlerFor('POST', '/api/devices')(
      fakeReq({
        method: 'POST',
        url: '/api/devices',
        body: JSON.stringify({ id: 'dev-1', fcmToken: 'fcm-raw-value', platform: 'android', token: GW_TOKEN }),
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain(GW_TOKEN);
    expect(raw).not.toContain('fcm-raw-value');
    expect(JSON.parse(raw).devices[0].apiTokenHash).toBe(sha(GW_TOKEN, 16));
  });

  it('token 与配置的网关 token 不一致 → 401，且不落盘', async () => {
    const file = tmpStoreFile();
    const { gateway, handlerFor } = setup({ file });
    const r = fakeRes();

    await handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        body: JSON.stringify({ token: 'wrong-token', platform: 'android', deviceName: 'pixel' }),
      }),
      r.res,
    );

    expect(r.status).toBe(401);
    expect(JSON.parse(r.body).error).toMatch(/token/i);
    expect(gateway.listDevices()).toHaveLength(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('未配置网关 token（空）时保持旧行为（不做比对）', async () => {
    const file = tmpStoreFile();
    const { gateway, handlerFor } = setup({ file, apiToken: () => '' });
    const r = fakeRes();

    await handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        body: JSON.stringify({ token: 'any-device-token', platform: 'android' }),
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    expect(gateway.listDevices()).toHaveLength(1);
  });
});

describe('旧格式设备记录兼容（E1-10 c）', () => {
  it('只有 fcmToken、无 apiTokenHash 的旧记录可加载并列出', () => {
    const file = tmpStoreFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      devices: [
        { id: 'legacy-1', fcmToken: 'legacy-token', platform: 'android', lastSeen: '2026-01-01T00:00:00.000Z' },
      ],
    }), 'utf8');

    const store = new DeviceStore(file);
    const devices = store.list();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('legacy-1');
    expect(devices[0].apiTokenHash).toBe('');

    // 列表路由同样不崩。
    const { handlerFor } = setup({ file });
    const r = fakeRes();
    void handlerFor('GET', '/api/mobile/devices')(fakeReq({ method: 'GET', url: '/api/mobile/devices' }), r.res);
    return Promise.resolve().then(() => {
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).devices[0].id).toBe('legacy-1');
    });
  });
});

describe('DeviceStore.register 单点防御（E1-10）', () => {
  it('任何调用方传入的 fcmToken 都不会落盘', () => {
    const file = tmpStoreFile();
    const store = new DeviceStore(file);
    store.register({ id: 'd1', fcmToken: 'raw-secret', platform: 'ios', apiTokenHash: 'h1' });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('raw-secret');
    expect(JSON.parse(raw).devices[0]).toMatchObject({ id: 'd1', fcmToken: '', apiTokenHash: 'h1' });
  });
});
