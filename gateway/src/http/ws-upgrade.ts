/**
 * WebSocket hub — /api/ws + voice + terminal + plugin upgrade routing
 * (D3 Task 3). Extracted from `MafwScheduler.startApiServer()`.
 *
 * The three `WebSocketServer` instances are `noServer`, so this module owns the
 * single `server.on('upgrade')` fan-out, in the original order:
 *   voice (isVoiceUpgradePath) → terminal (matchTerminalConnectUrl) →
 *   plugin (parsePluginWsUrl) → /api/ws (mobile events + send).
 * Auth stays per-route: voice//api/ws use authorizeWsUpgrade (loopback bypass),
 * terminal is loopback-only, plugin auth lives in the handler.
 *
 * Timers: the 30s heartbeat (2 missed pongs → terminate) and the 60s
 * PushGateway maintenance are unref'ed and — before this extraction — never
 * cleared (the process owns them). `dispose()` exposes the clear for the
 * kernel's graceful shutdown path; it is not wired into `stop()` because the
 * class never tore the hub down before.
 */

import * as http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { authorizeWsUpgrade, isLoopbackAddr } from '../core/auth';
import { log } from '../core/utils/logger';
import type { ConnectionKind, ConnectionLease, ConnectionTable } from '../resources/connections';
import { BufferCounters, sendWsBounded } from '../resources/outbound-buffer';
import { matchTerminalConnectUrl } from '../terminal/terminal-protocol';
import type { TerminalService } from '../terminal/terminal-service';
import { attachVoiceSocket, isVoiceUpgradePath } from '../voice/transport/ws-voice';
import type { VoiceRuntime } from '../voice/runtime';
import type { PushGateway } from '../mobile/push-gateway';
import {
  handlePluginWsUpgrade,
  parsePluginWsUrl,
} from '../routes/plugin-web';
import type { PluginWebRouteDeps } from '../routes/plugin-web';

export interface WsHubDeps {
  /** The kernel's `wsClients` set (broadcast() writes through the same set). */
  wsClients: Set<WebSocket>;
  apiToken(): string;
  pushGateway(): PushGateway | undefined;
  handleWsMessage(ws: WebSocket, raw: Buffer | ArrayBuffer | Buffer[]): void;
  getVoiceRuntime(): Promise<VoiceRuntime>;
  getTerminalService(): TerminalService;
  pluginWebDeps(): PluginWebRouteDeps;
  /**
   * E2-4: live event-log head seq for the `connected` greeting. WS is live-only
   * (no replay): clients use this to know where the live stream resumes and
   * must reconcile via the SSE cursor or a REST snapshot after reconnect.
   * null = no persistent event store (live-only deployment).
   */
  headSeq?: () => number | null;
  /** E4-4: live 连接表；缺省 = 不限制（向后兼容）。 */
  connections?: () => ConnectionTable | null;
  /** E4-5: WS 出站缓冲聚合计数（与 EventHub 共享）。 */
  counters?: BufferCounters;
  /** E4-5: greeting 帧的背压上限；缺省 = 不检查（旧行为）。 */
  wsMaxBufferedBytes?: () => number;
}

export interface WsHub {
  wss: WebSocketServer;
  voiceWss: WebSocketServer;
  terminalWss: WebSocketServer;
  /** Clears the heartbeat + PushGateway maintenance timers. */
  dispose(): void;
}

export type UpgradeAdmission =
  | { ok: true; lease: ConnectionLease | null }
  | { ok: false };

/**
 * E4-4: upgrade 准入。在 `handleUpgrade` 之前调用；没有连接表时永远放行
 * （`lease: null`），因此旧调用方无需改动。
 */
export function admitUpgrade(
  kind: ConnectionKind,
  connections: (() => ConnectionTable | null) | undefined,
): UpgradeAdmission {
  let table: ConnectionTable | null;
  try {
    table = connections?.() ?? null;
  } catch {
    // 连接表读取失败按拒绝处理（fail-closed）：宁可 503，也不放一个未记账的
    // 长连接进来。绝不把异常抛进 upgrade handler（会打挂 server）。
    return { ok: false };
  }
  if (!table) return { ok: true, lease: null };
  try {
    const lease = table.tryAcquire(kind);
    return lease ? { ok: true, lease } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export interface UpgradeSocketLike {
  write(chunk: string): unknown;
  end?(chunk?: string): unknown;
  destroy?(): void;
  once?(event: string, listener: () => void): unknown;
  on?(event: string, listener: () => void): unknown;
}

/** E4-4: 拒绝 upgrade —— 在 socket 上手写 503（此时还没有 HTTP 响应对象）。 */
export function refuseUpgrade(socket: UpgradeSocketLike, kind: ConnectionKind): void {
  const body = JSON.stringify({
    error: `too many ${kind} connections`,
    code: 'connection_limit',
  });
  const payload = 'HTTP/1.1 503 Service Unavailable\r\n'
    + 'Content-Type: application/json\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + 'Connection: close\r\n\r\n'
    + body;

  if (typeof socket.end === 'function') {
    // 先 end 把响应写进内核缓冲，'finish' 后再 destroy；立即 destroy 会丢掉
    // 尚未 flush 的 503 body（客户端只看到连接重置）。
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      try { socket.destroy?.(); } catch { /* already gone */ }
    };
    try {
      (socket.once ?? socket.on)?.('finish', finish);
      socket.end(payload);
    } catch {
      finish();
    }
    return;
  }

  socket.write(payload);
  socket.destroy?.();
}

/**
 * 把 lease 绑到连接生命周期：close / error 都可能先到，`lease.release()` 幂等。
 * 插件 WS 升级后 socket 本身就是底层长连接，绑 socket；voice/terminal/api-ws
 * 绑 `ws` 实例。
 */
function bindLease(emitter: { on?(event: string, listener: () => void): unknown } | undefined, lease: ConnectionLease | null): void {
  if (!lease) return;
  try {
    emitter?.on?.('close', () => lease.release());
    emitter?.on?.('error', () => lease.release());
  } catch {
    lease.release();
  }
}

export function createWsHub(server: http.Server, deps: WsHubDeps): WsHub {
  const wss = new WebSocketServer({ noServer: true });
  const voiceWss = new WebSocketServer({ noServer: true });
  const terminalWss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    deps.wsClients.add(ws);
    (ws as any).isAlive = true;
    (ws as any).missedPongs = 0;
    ws.on('pong', () => { (ws as any).isAlive = true; (ws as any).missedPongs = 0; });
    const greeting = JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString(),
      vocab: 'v2',
      // E2-4: live-only channel — headSeq marks where live delivery resumes;
      // replay/reconnect is the SSE cursor's or REST snapshot's job.
      headSeq: deps.headSeq?.() ?? null,
    });
    // E4-5: 只有 kernel 注入上限时才检查背压，缺省保持旧的 `ws.send`。
    if (deps.wsMaxBufferedBytes) {
      if (!sendWsBounded(ws as any, greeting, deps.wsMaxBufferedBytes(), deps.counters)) {
        deps.wsClients.delete(ws);
        const deviceId = (ws as any).deviceId;
        if (deviceId) deps.pushGateway()?.removeOnlineWs(deviceId);
        return;
      }
    } else {
      ws.send(greeting);
    }
    ws.on('message', (raw) => {
      void deps.handleWsMessage(ws, raw);
    });
    ws.on('close', () => {
      deps.wsClients.delete(ws);
      const deviceId = (ws as any).deviceId;
      if (deviceId) deps.pushGateway()?.removeOnlineWs(deviceId);
    });
    ws.on('error', () => {
      deps.wsClients.delete(ws);
      const deviceId = (ws as any).deviceId;
      if (deviceId) deps.pushGateway()?.removeOnlineWs(deviceId);
    });
  });

  // WS heartbeat: ping every 30s, prune dead connections after 2 missed pongs (60s).
  const wsPingInterval = setInterval(() => {
    for (const ws of deps.wsClients) {
      if ((ws as any).isAlive === false) {
        (ws as any).missedPongs = ((ws as any).missedPongs || 0) + 1;
        if ((ws as any).missedPongs >= 2) {
          deps.wsClients.delete(ws);
          const deviceId = (ws as any).deviceId;
          if (deviceId) deps.pushGateway()?.removeOnlineWs(deviceId);
          try { ws.terminate(); } catch { /* already closed */ }
          continue;
        }
      }
      (ws as any).isAlive = false;
      try { ws.ping(); } catch {
        deps.wsClients.delete(ws);
        const deviceId = (ws as any).deviceId;
        if (deviceId) deps.pushGateway()?.removeOnlineWs(deviceId);
      }
    }
  }, 30_000);
  // Allow the process to exit without waiting for the ping timer.
  if (wsPingInterval.unref) wsPingInterval.unref();

  // Periodic PushGateway maintenance: sync lastSeen, prune stale online WS + expired device registrations.
  const deviceCleanupInterval = setInterval(() => {
    // 1. Remove WS entries with no activity for 2 minutes.
    deps.pushGateway()?.cleanupStale(120_000);
    // 2. Sync in-memory lastSeen to DeviceStore so active devices aren't pruned.
    //    This bridges the gap between WS heartbeat (updates in-memory only)
    //    and pruneDeviceStore (checks persisted lastSeen).
    deps.pushGateway()?.syncLastSeenToDeviceStore();
    // 3. Prune device-store entries not seen for 7 days (FCM token expiry hygiene).
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const pruned = deps.pushGateway()?.pruneDeviceStore(cutoff);
    if (pruned && pruned.length > 0) {
      log.info(`[PushGateway] pruned ${pruned.length} stale device(s) from store`);
    }
  }, 60_000);
  if (deviceCleanupInterval.unref) deviceCleanupInterval.unref();

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    // Token auth on upgrade: delegated to core/auth.ts
    const rawAddr = (req.socket as any)?.remoteAddress || (socket as any).remoteAddress || '';
    const wsToken = deps.apiToken();

    if (isVoiceUpgradePath(url)) {
      if (!isLoopbackAddr(rawAddr)) {
        const wsAuth = authorizeWsUpgrade({ remoteAddress: rawAddr, headers: req.headers as any, url, host: String(req.headers.host || '') }, wsToken);
        if (!wsAuth.ok) {
          socket.write(wsAuth.rejectResponse!);
          socket.destroy();
          return;
        }
      }
      const admitted = admitUpgrade('voice', deps.connections);
      if (!admitted.ok) {
        refuseUpgrade(socket, 'voice');
        return;
      }
      // abortHandshake 可能既不回调也不抛错 —— lease 同时绑 socket，close 时必释放。
      bindLease(socket as any, admitted.lease);
      try {
        voiceWss.handleUpgrade(req, socket, head, (ws) => {
          bindLease(ws as any, admitted.lease);
          attachVoiceSocket(ws as any, {
            createSession: async () => (await deps.getVoiceRuntime()).createSession(
              (m) => ws.send(JSON.stringify(m)),
            ),
          });
        });
      } catch (err) {
        admitted.lease?.release();
        throw err;
      }
      return;
    }

    const terminalRequest = matchTerminalConnectUrl(url);
    if (terminalRequest) {
      // 中性终端 WS：loopback-only + 一次性 ticket（ticket 自带目录绑定）。
      if (!isLoopbackAddr(rawAddr)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const admitted = admitUpgrade('terminal', deps.connections);
      if (!admitted.ok) {
        refuseUpgrade(socket, 'terminal');
        return;
      }
      bindLease(socket as any, admitted.lease);
      try {
        terminalWss.handleUpgrade(req, socket, head, (ws) => {
          bindLease(ws as any, admitted.lease);
          void deps.getTerminalService()
            .bridge({ socket: ws as any, id: terminalRequest.id, ticket: terminalRequest.ticket })
            .catch(() => {
              try { ws.close(4502, 'terminal bridge failed'); } catch { /* already closed */ }
            });
        });
      } catch (err) {
        admitted.lease?.release();
        throw err;
      }
      return;
    }

    const pluginWs = parsePluginWsUrl(url);
    if (pluginWs) {
      // E4-4：插件 WS 是长连接（插件 UI 的 PTY 等），计入 `ws` 名额；拒绝也
      // 消费 socket。lease 绑到 socket 本身——升级后它就是底层连接。
      const admitted = admitUpgrade('ws', deps.connections);
      if (!admitted.ok) {
        refuseUpgrade(socket, 'ws');
        return;
      }
      bindLease(socket as any, admitted.lease);
      // 票据 cookie / loopback 鉴权在 handler 内完成；拒绝也消费 socket。
      try {
        const handled = handlePluginWsUpgrade(deps.pluginWebDeps(), req, socket, head);
        if (!handled) admitted.lease?.release();
      } catch (err) {
        admitted.lease?.release();
        throw err;
      }
      return;
    }

    if (!url.startsWith('/api/ws')) {
      socket.destroy();
      return;
    }
    const wsAuth = authorizeWsUpgrade({ remoteAddress: rawAddr, headers: req.headers as any, url, host: String(req.headers.host || '') }, wsToken);
    if (!wsAuth.ok) {
      socket.write(wsAuth.rejectResponse!);
      socket.destroy();
      return;
    }
    const admitted = admitUpgrade('ws', deps.connections);
    if (!admitted.ok) {
      refuseUpgrade(socket, 'ws');
      return;
    }
    bindLease(socket as any, admitted.lease);
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        bindLease(ws as any, admitted.lease);
        // Extract deviceId from query string for PushGateway tracking
        try {
          const q = new URL(url, `http://${req.headers.host || 'localhost'}`);
          const deviceId = q.searchParams.get('deviceId');
          if (deviceId) {
            (ws as any).deviceId = deviceId;
            deps.pushGateway()?.addOnlineWs(deviceId, ws);
          }
        } catch { /* non-fatal */ }
        wss.emit('connection', ws, req);
      });
    } catch (err) {
      admitted.lease?.release();
      throw err;
    }
  });

  return {
    wss,
    voiceWss,
    terminalWss,
    dispose: () => {
      clearInterval(wsPingInterval);
      clearInterval(deviceCleanupInterval);
    },
  };
}
