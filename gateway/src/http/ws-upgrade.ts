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
}

export interface WsHub {
  wss: WebSocketServer;
  voiceWss: WebSocketServer;
  terminalWss: WebSocketServer;
  /** Clears the heartbeat + PushGateway maintenance timers. */
  dispose(): void;
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
    ws.send(JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString(),
      vocab: 'v2',
      // E2-4: live-only channel — headSeq marks where live delivery resumes;
      // replay/reconnect is the SSE cursor's or REST snapshot's job.
      headSeq: deps.headSeq?.() ?? null,
    }));
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
      voiceWss.handleUpgrade(req, socket, head, (ws) => {
        attachVoiceSocket(ws as any, {
          createSession: async () => (await deps.getVoiceRuntime()).createSession(
            (m) => ws.send(JSON.stringify(m)),
          ),
        });
      });
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
      terminalWss.handleUpgrade(req, socket, head, (ws) => {
        void deps.getTerminalService()
          .bridge({ socket: ws as any, id: terminalRequest.id, ticket: terminalRequest.ticket })
          .catch(() => {
            try { ws.close(4502, 'terminal bridge failed'); } catch { /* already closed */ }
          });
      });
      return;
    }

    const pluginWs = parsePluginWsUrl(url);
    if (pluginWs) {
      // 票据 cookie / loopback 鉴权在 handler 内完成；拒绝也消费 socket。
      handlePluginWsUpgrade(deps.pluginWebDeps(), req, socket, head);
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
    wss.handleUpgrade(req, socket, head, (ws) => {
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
