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
 *   POST   /api/mobile/pairing/verify      — mobile.pairingVerify（消费 nonce）
 *
 * handler 体从 index.ts legacy 分支逐字迁移：apiTokenHash 仍服务端算
 * （createHash sha256 → 16 hex），mobile 注册仍把 token 同时当 fcmToken 与
 * apiTokenHash（32/16 前缀），配对 503/400/429 语义与错误文案原样保留。
 * id/路径参数由 registry 预先 decode（legacy 自行 decodeURIComponent）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { readRouteBody } from './cognition';
import type { PushGateway } from '../mobile/push-gateway';
import type { PairingService } from '../mobile/pairing';
import type { RouteRegistry } from './registry';

export interface DevicesMobileRouteDeps {
  pushGateway: () => PushGateway | undefined;
  pairingService: () => PairingService | undefined;
}

export function attachDevicesMobileRoutes(registry: RouteRegistry, deps: DevicesMobileRouteDeps): void {
  // POST /api/devices — register a mobile device for push notifications
  registry.attachHandler('devices.register', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readRouteBody(req));
      const { id, fcmToken, platform, token } = body;
      if (!id || !fcmToken || !platform || !token) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'id, fcmToken, platform, token required' }));
        return;
      }
      // SECURITY: Compute apiTokenHash server-side from the token
      const { createHash } = require('crypto');
      const apiTokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
      const entry = deps.pushGateway()?.registerDevice({ id, fcmToken, platform, apiTokenHash });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, device: entry }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/mobile/devices — list registered devices
  registry.attachHandler('mobile.devicesList', async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices: deps.pushGateway() ? deps.pushGateway()!.listDevices() : [] }));
  });

  // DELETE /api/mobile/devices/:id — remove a device
  registry.attachHandler('mobile.devicesDelete', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    const ok = deps.pushGateway() ? deps.pushGateway()!.removeDevice(id) : false;
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { ok: true } : { error: 'device not found' }));
  });

  // GET /api/devices — legacy alias for list
  registry.attachHandler('devices.list', async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices: deps.pushGateway() ? deps.pushGateway()!.listDevices() : [] }));
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
      const { createHash } = require('crypto');
      const id = createHash('sha256').update(token).digest('hex').slice(0, 32);
      const apiTokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
      const entry = deps.pushGateway()?.registerDevice({ id, fcmToken: token, platform, apiTokenHash });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, device: entry }));
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

  // POST /api/mobile/pairing/verify — consume a pairing nonce after mobile scan
  registry.attachHandler('mobile.pairingVerify', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!deps.pairingService()) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'Pairing service not available' }));
        return;
      }
      const body = JSON.parse(await readRouteBody(req));
      const { nonce } = body;
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
