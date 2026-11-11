/**
 * E1-10（修正后契约）：设备注册持久化的是 **FCM push token**，不是网关凭据。
 *
 * 背景（2026-11-11 review 更正）：`mobile/lib/src/services/push_service.dart`
 * 把 FCM token 放在 `body.token`，网关 bearer token 只放 `Authorization` 头。
 * 因此设备库里的 `fcmToken` 就是推送 token（必须保留，否则真实推送丢失），
 * 而「网关 token 被明文写库」的原始前提不成立 —— 原始实现从未持久化 bearer token。
 *
 * 本文件钉住：
 *  (a) 注册后磁盘上 fcmToken === 客户端给的 FCM token；apiTokenHash 存在且为
 *      sha256(FCM token)[0..16]；请求头里的网关 bearer token 不出现在文件里；
 *  (b) legacy `/api/devices` 同样持久化 body.fcmToken；
 *  (c) 旧格式记录（无 apiTokenHash）仍能加载/列出，不崩；
 *  (d) `DeviceStore.register` 单点：输入什么 fcmToken 就存什么。
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

const FCM_TOKEN = 'fcm_push_token_xyz';
const GW_TOKEN = 'gw-bearer-token-should-never-be-stored';
const sha = (value: string, len: number) => createHash('sha256').update(value).digest('hex').slice(0, len);

function fakeReq(opts: { method: string; url: string; body?: string; headers?: Record<string, string> }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: opts.headers ?? {},
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

function setup(opts: { file: string }) {
  const store = new DeviceStore(opts.file);
  const gateway = new PushGateway(store);
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachDevicesMobileRoutes(registry, {
    pushGateway: () => gateway,
    pairingService: () => undefined,
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

describe('设备注册：FCM token 持久化 / 网关 token 不落库（E1-10 修正）', () => {
  it('mobile 注册：FCM token 持久化 + hash；Authorization 里的网关 token 不出现在文件', async () => {
    const file = tmpStoreFile();
    const { gateway, handlerFor } = setup({ file });
    const r = fakeRes();

    await handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        headers: { authorization: `Bearer ${GW_TOKEN}` },
        body: JSON.stringify({ token: FCM_TOKEN, platform: 'android', deviceName: 'pixel' }),
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    const raw = fs.readFileSync(file, 'utf8');
    // FCM token 必须保留（唯一的推送 token）。
    expect(raw).toContain(FCM_TOKEN);
    // 网关 bearer token 从不进入设备记录。
    expect(raw).not.toContain(GW_TOKEN);

    const stored = JSON.parse(raw).devices[0];
    expect(stored.id).toBe(sha(FCM_TOKEN, 32));
    expect(stored.fcmToken).toBe(FCM_TOKEN);
    expect(stored.apiTokenHash).toBe(sha(FCM_TOKEN, 16));
    expect(gateway.listDevices()).toHaveLength(1);
  });

  it('legacy /api/devices：持久化 body.fcmToken（body.token 只用于派生 hash）', async () => {
    const file = tmpStoreFile();
    const { handlerFor } = setup({ file });
    const r = fakeRes();

    await handlerFor('POST', '/api/devices')(
      fakeReq({
        method: 'POST',
        url: '/api/devices',
        headers: { authorization: `Bearer ${GW_TOKEN}` },
        body: JSON.stringify({ id: 'dev-1', fcmToken: 'fcm-raw-value', platform: 'android', token: 'legacy-hash-seed' }),
      }),
      r.res,
    );

    expect(r.status).toBe(200);
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toContain('fcm-raw-value');
    expect(raw).not.toContain(GW_TOKEN);
    expect(JSON.parse(raw).devices[0]).toMatchObject({
      id: 'dev-1',
      fcmToken: 'fcm-raw-value',
      apiTokenHash: sha('legacy-hash-seed', 16),
    });
  });

  it('body.token 与网关配置无关：不匹配也不 401（真实客户端发的是 FCM token）', async () => {
    const file = tmpStoreFile();
    const { gateway, handlerFor } = setup({ file });
    const r = fakeRes();

    await handlerFor('POST', '/api/mobile/devices/register')(
      fakeReq({
        method: 'POST',
        url: '/api/mobile/devices/register',
        body: JSON.stringify({ token: 'some-fcm-token', platform: 'android' }),
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
    expect(devices[0].fcmToken).toBe('legacy-token');
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

describe('DeviceStore.register 单点契约（E1-10 修正）', () => {
  it('输入什么 fcmToken 就持久化什么', () => {
    const file = tmpStoreFile();
    const store = new DeviceStore(file);
    store.register({ id: 'd1', fcmToken: 'fcm-token-value', platform: 'ios', apiTokenHash: 'h1' });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).toContain('fcm-token-value');
    expect(JSON.parse(raw).devices[0]).toMatchObject({ id: 'd1', fcmToken: 'fcm-token-value', apiTokenHash: 'h1' });
  });
});
