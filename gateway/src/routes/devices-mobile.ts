/**
 * Phase D1 Task H2: devices + mobile 设备/配对面 → registry dispatch。
 *
 *   POST   /api/devices                    — devices.register（legacy 注册别名）
 *   GET    /api/devices                    — devices.list（legacy 列表别名）
 *   DELETE /api/devices/:id                — devices.delete（legacy 删除别名）
 *   GET    /api/mobile/devices             — mobile.devicesList
 *   DELETE /api/mobile/devices/:id         — mobile.devicesDelete
 *   POST   /api/mobile/devices/register    — mobile.devicesRegister（{token,platform,deviceName} → push 形状）
 *   GET    /api/mobile/pairing-code        — mobile.pairingCode（单次配对 URL；rate limit → 429）
 *   POST   /api/mobile/pairing/verify      — mobile.pairingVerify（消费 nonce → 发设备凭据）
 *
 * handler 体从 index.ts legacy 分支逐字迁移：apiTokenHash 仍服务端算
 * （createHash sha256 → 16 hex）。`body.token` 是客户端上报的 **FCM push token**
 * （`mobile/lib/src/services/push_service.dart`），网关 bearer token 只走
 * Authorization 头、从不进入设备记录；`fcmToken` 字段按原样持久化。
 * 配对 503/400/429 语义与错误文案原样保留。
 * id/路径参数由 registry 预先 decode（legacy 自行 decodeURIComponent）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2。
 *
 * E5a-3 (spec 2026-11-12-gateway-e5a-identity-closure-design.md §3.2):
 *   - `mobile.pairingVerify` 用 nonce 换 **per-device** token（`dev_` + 32B
 *     base64url），只存 sha256；响应 `{ok:true, token, deviceId}`。
 *   - 设备注册优先用 transport 解析出的 `principal.deviceId`（stable id），
 *     无 principal 时保留旧的 FCM-hash 派生（legacy 兼容）。
 *   - 列表一律走 `listPublicDevices()`（去掉 deviceTokenHash / apiTokenHash）。
 *   - token 不落日志（redactLog 已覆盖 `dev_…`）。
 */
import * as crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { readRouteBody } from './cognition';
import { toPublicDevice } from '../mobile/device-store';
import type { PushGateway } from '../mobile/push-gateway';
import type { PairingService } from '../mobile/pairing';
import type { RouteRegistry } from './registry';

export interface DevicesMobileRouteDeps {
  pushGateway: () => PushGateway | undefined;
  pairingService: () => PairingService | undefined;
}

const DEVICE_TOKEN_PREFIX = 'dev_';

/** `dev_` + 32 random bytes (base64url) — high-entropy, URL/header safe. */
export function generateDeviceToken(): string {
  return `${DEVICE_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
}

/** Stable device id when the client does not send one. */
export function generateDeviceId(): string {
  const c = crypto as typeof crypto & { randomUUID?: () => string };
  return typeof c.randomUUID === 'function'
    ? c.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

/** Device id resolved by the transport (device-token principal). */
function principalDeviceId(req: IncomingMessage): string | undefined {
  const id = (req as any).mafwPrincipal?.deviceId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * `apiTokenHash` = sha256(the token the device presents) → 16 hex, computed
 * server-side so the client cannot choose it. For mobile registration the
 * presented token is the **FCM push token** (`push_service.dart` sends it in
 * `body.token`); the gateway bearer token travels only in the Authorization
 * header and is never part of the device record.
 */
function apiTokenHashOf(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function attachDevicesMobileRoutes(registry: RouteRegistry, deps: DevicesMobileRouteDeps): void {
  // POST /api/devices — register a mobile device for push notifications
  registry.attachHandler('devices.register', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readRouteBody(req));
      const { fcmToken, platform, token } = body;
      // E5a-3: a device-token principal carries the stable device id; body.id
      // remains the legacy fallback for shared-token / loopback clients.
      const id = principalDeviceId(req) ?? body.id;
      if (!id || !fcmToken || !platform || !token) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'id, fcmToken, platform, token required' }));
        return;
      }
      // SECURITY: Compute apiTokenHash server-side from the presented token.
      const apiTokenHash = apiTokenHashOf(String(token));
      // `fcmToken` is the FCM push token sent by the client (not a credential).
      const entry = deps.pushGateway()?.registerDevice({ id, fcmToken, platform, apiTokenHash });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, device: entry ? toPublicDevice(entry) : entry }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/mobile/devices — list registered devices (credential hashes stripped)
  registry.attachHandler('mobile.devicesList', async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices: deps.pushGateway() ? deps.pushGateway()!.listPublicDevices() : [] }));
  });

  // DELETE /api/mobile/devices/:id — remove a device (hard revocation)
  registry.attachHandler('mobile.devicesDelete', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    const ok = deps.pushGateway() ? deps.pushGateway()!.removeDevice(id) : false;
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { ok: true } : { error: 'device not found' }));
  });

  // GET /api/devices — legacy alias for list
  registry.attachHandler('devices.list', async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices: deps.pushGateway() ? deps.pushGateway()!.listPublicDevices() : [] }));
  });

  // DELETE /api/devices/:id — legacy alias for remove
  registry.attachHandler('devices.delete', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    const ok = deps.pushGateway() ? deps.pushGateway()!.removeDevice(id) : false;
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { ok: true } : { error: 'device not found' }));
  });

  // POST /api/mobile/devices/register — mobile device registration alias
  // Maps mobile's { token, platform, deviceName } to gateway's { id, fcmToken, platform, apiTokenHash }
  registry.attachHandler('mobile.devicesRegister', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readRouteBody(req));
      const { token, platform, deviceName } = body;
      if (!token || !platform) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'token and platform required' }));
        return;
      }
      // `token` 是客户端上报的 FCM push token（push_service.dart body.token），
      // 不是网关 bearer token；id/hash 都由服务端从它派生并持久化。
      // E5a-3: 配过对的设备用 principal.deviceId 作为稳定 id（与 pairingVerify
      // 发的凭据绑定）；未配对的老客户端保留 FCM-hash 派生 id。
      const id = principalDeviceId(req) ?? crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
      const apiTokenHash = apiTokenHashOf(String(token));
      const entry = deps.pushGateway()?.registerDevice({ id, fcmToken: token, platform, apiTokenHash });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, device: entry ? toPublicDevice(entry) : entry }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/mobile/pairing-code — generate a single-use pairing URL for mobile scan
  registry.attachHandler('mobile.pairingCode', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!deps.pairingService()) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'Pairing service not available' }));
        return;
      }
      const ip = req.socket.remoteAddress || '';
      const result = deps.pairingService()!.generatePairingCode(ip);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      const msg = err?.message || String(err);
      const status = /rate limit/i.test(msg) ? 429 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  // POST /api/mobile/pairing/verify — exchange a pairing nonce for a device token.
  //
  // Unauthenticated by design: the nonce (single-use, 5-min TTL, rate-limited
  // at generation) IS the credential. The transport/registry exempt only this
  // exact route (E5a-3); the response never echoes the nonce and the token is
  // masked by `redactLog` as `dev_***`.
  registry.attachHandler('mobile.pairingVerify', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!deps.pairingService()) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'Pairing service not available' }));
        return;
      }
      if (!deps.pushGateway()) {
        // Check before consuming the nonce so the client can retry after the
        // service is available.
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'Push gateway not available' }));
        return;
      }
      const body = JSON.parse(await readRouteBody(req));
      const { nonce, deviceId, platform, deviceName } = body;
      if (!nonce) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'nonce required' }));
        return;
      }
      const consumed = deps.pairingService()!.consumeNonce(nonce);
      if (!consumed) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid or expired pairing nonce' }));
        return;
      }

      const resolvedDeviceId = typeof deviceId === 'string' && deviceId.length > 0
        ? deviceId
        : generateDeviceId();
      const resolvedPlatform = typeof platform === 'string' && platform.length > 0
        ? platform
        : 'unknown';
      const token = generateDeviceToken();
      deps.pushGateway()!.issueDeviceToken(resolvedDeviceId, token, {
        platform: resolvedPlatform,
        deviceName: typeof deviceName === 'string' && deviceName.length > 0 ? deviceName : undefined,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, token, deviceId: resolvedDeviceId }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
