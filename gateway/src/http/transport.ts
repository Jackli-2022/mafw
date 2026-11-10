/**
 * HTTP transport — the gateway request listener (D3 Task 3, ruling D3-R3).
 *
 * This is the body of the callback that used to live inline in
 * `MafwScheduler.startApiServer()`: CORS + OPTIONS, apiToken auth, registry
 * dispatch, plugin-web wildcard, file-history, the A2A endpoints, MCP (legacy
 * SSE + StreamableHTTP), the dashboard SPA, the dashboard joint catch-all,
 * /register, /control, /health, the reverse proxy and the outer 500 catch.
 *
 * Ordering is load-bearing and preserved EXACTLY (spec §4 / AGENTS.md §6.5):
 *   OPTIONS(204) → apiToken auth(401) → registry dispatch → plugin web →
 *   file history → transport branches → dashboard joint catch-all →
 *   /register → /control → /health → reverse proxy → 500.
 * The dashboard joint MUST stay before `/control`: it shadows the
 * `/api/goals/control` arm (ruling R6, latent since cdf678db2 — deliberately
 * not fixed here). `/health` is two branches: the rich 200 (GET) and the dead
 * plain arm that can only be reached by non-GET methods.
 *
 * URL parsing (ruling D3-R2): the raw url and pathname are computed once at the
 * top; every downstream branch compares explicitly. No `req.url`-anchored
 * regex / startsWith dispatch lives in this file.
 *
 * Cycle safety: type-only deps, never a runtime import of the kernel/entry.
 * Every mutable kernel field is threaded as a live getter (D1 discipline) —
 * passing a value capture would resurrect the 2026-09-17 regression class.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { authorizeRequest, isLoopbackAddr } from '../core/auth';
import { readBody } from '../core/http/http-util';
import { log } from '../core/utils/logger';
import { injectServeAuth } from '../runtime/proxy-auth';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { MediaAgent } from '../media/media-agent';
import type { McpSSEEndpoint } from '../mcp/sse-transport';
import type { McpStreamableEndpoint } from '../mcp/streamable-endpoint';

export type RequestListener = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => Promise<void>;

/** CORS response headers (was `config.server.cors`). */
export interface TransportCorsHeaders {
  origin: string;
  methods: string;
  headers: string;
}

/**
 * POST /register intake (transport branch; ruling D3-R3 keeps the body here and
 * threads the kernel state through callbacks).
 */
export interface RegisterIntakePort {
  parseIntent(body: unknown): { projectDir: string; mafwDir: string; setCurrent: boolean } | null;
  isUserDataDir(projectDir: string): boolean;
  /** `isSelectableProject(dir, resolveRuntimeRoot())` bound by the kernel. */
  isSelectableProject(projectDir: string): boolean;
  registeredProject(projectDir: string): { mafwDir: string; registeredAt: string } | undefined;
  registerProject(
    projectDir: string,
    entry: { projectDir: string; mafwDir: string; registeredAt: string },
  ): void;
  setCurrentProject(projectDir: string): void;
  persistRegistry(): Promise<void>;
  broadcastProjectRegistered(projectDir: string): void;
  hasRuntime(): boolean;
  ensureManagerSession(projectDir: string, mafwDir: string): Promise<unknown>;
}

/** POST /control (and its `/api/goals/control` SDK alias) — same processControlFile semantics. */
export interface ControlPort {
  patchState(goalId: string, patch: Record<string, unknown>): Promise<void>;
  destroyAllSessions(goalId: string): Promise<void>;
  getActiveGoal(goalId: string): { loop?: number } | undefined;
  registeredProjects(): Iterable<[string, { mafwDir: string }]>;
  getGatewayDb(): GatewayDatabase;
  archiveGoal(goalId: string, outcome: Record<string, unknown>): Promise<void>;
}

/** GET /health (rich arm) fields — each one a live getter. */
export interface HealthPort {
  serveRunning(): boolean;
  registeredProjectDirs(): string[];
  activeGoalIds(): string[];
  mediaConfigured(): boolean;
  releaseFields(): Record<string, unknown>;
}

export interface TransportDeps {
  /** `config.server.cors` — live getter (config is reloadable at runtime). */
  cors(): TransportCorsHeaders;
  /** `(config.raw as any)?.server?.apiToken || ''` — live (config is reloadable). */
  apiToken(): string;
  /** Registry-first dispatch (`routes/registry-dispatch`); auth already passed. */
  dispatchAuthorized(req: http.IncomingMessage, res: http.ServerResponse, apiToken: string): Promise<boolean>;
  /** `Scheduler.handlePluginWebWildcard` — `ui/*` / `api/*` plugin surfaces. */
  pluginWebWildcard(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean>;
  /** `routes/file-history` (loopback-only), kernel binds service + directory resolution. */
  fileHistory(req: http.IncomingMessage, res: http.ServerResponse, isLoopback: boolean): Promise<boolean>;
  mediaAgent(): MediaAgent | undefined;
  mcpEndpoint(): McpSSEEndpoint | undefined;
  mcpStreamable(): McpStreamableEndpoint | undefined;
  /** `config.paths.dashboardPublic`. */
  spaRoot(): string;
  /**
   * `subsystems/dashboard-legacy.ts` `handleDashboardAPI` (R5 joint catch-all;
   * the kernel hands it `this.dashboardLegacyDeps()`). Returns the JSON body.
   */
  dashboardDispatch(req: http.IncomingMessage): Promise<{ status: number; body: unknown }>;
  register: RegisterIntakePort;
  control: ControlPort;
  health: HealthPort;
  /** `runtimeHost.getBaseUrl?.() ?? config.server.serveUrl` — live (adopt rewrites it). */
  proxyTarget(): string;
  /** Serve credentials are adapter-owned; the kernel forwards `host.proxyHeaders()`. */
  proxyHeaders(): Record<string, string>;
}

/**
 * `GET /a2a/artifacts/<id>` — the prefix + single-segment form of the former
 * `^/a2a/artifacts/([^/]+)$` (same anchoring: non-empty id, no further slash).
 */
export function matchArtifactId(url: string): string | null {
  // 字面量前缀保留在 startsWith 里：api-contract 的源码路由面扫描靠它覆盖
  // catalog 的 `GET /a2a/artifacts/:id`（media.artifact）。
  if (!url.startsWith('/a2a/artifacts/')) return null;
  const id = url.slice('/a2a/artifacts/'.length);
  return id.length > 0 && !id.includes('/') ? id : null;
}

export function createRequestListener(deps: TransportDeps): RequestListener {
  const listener: RequestListener = async (req, res) => {
    // D3-R2：URL 只在这里解析一次；下游分支用显式 pathname/url 比较分发，
    // 不再在 req.url 上做 match / startsWith 式分发。
    const url = req.url || '';
    const pathname = url.split('?')[0];

    try {
      res.setHeader('Content-Type', 'application/json');

      // CORS headers come from the live `config.server.cors` getter (reloadable).
      const cors = deps.cors();
      res.setHeader("Access-Control-Allow-Origin", cors.origin);
      res.setHeader("Access-Control-Allow-Methods", cors.methods);
      res.setHeader("Access-Control-Allow-Headers", cors.headers);

      if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Loopback detection (delegated to core/auth.ts)
    const isLoopback = isLoopbackAddr(req.socket.remoteAddress || '');

    // API token auth: required for non-loopback connections when a token
    // is configured (MAFW_SERVER_API_TOKEN). Loopback connections bypass.
    const apiToken = deps.apiToken();
    if (!authorizeRequest({ remoteAddress: req.socket.remoteAddress || '', headers: req.headers as any, url: req.url, host: String(req.headers.host || '') }, apiToken)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    // P5 Wave 1: registry dispatch —— attach 过 handler 的路由在 legacy 链之前
    // 统一接管（shadow 条目无 handler 自然落回内联链）。**必须在鉴权之后**（P0-1）：
    // goals.sessions 须先于 dashboard 兜底、embedding-config 须先于 /api/memory/*
    // 委托（AGENTS.md §6.5 顺序教训由 dispatch 位置一次性满足）。
    if (await deps.dispatchAuthorized(req, res, apiToken)) return;

    // Plugin Web surfaces：registry 只支持精确段数，`ui/*` / `api/*` 的通配
    // 在这里匹配（必须早于 dashboard 委托与反代）。三个精确端点
    // （web-ticket / ui 基路径 / events）由上面的 registry dispatch 接管。
    if (await deps.pluginWebWildcard(req, res)) return;

    // 文件级历史（loopback-only）：office 技能保存前快照 / 桌面 / 调试。
    if (await deps.fileHistory(req, res, isLoopback)) return;

    // POST /a2a — A2A JSON-RPC (standard protocol methods)
    if (url === "/a2a" && req.method === "POST") {
      if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
      try {
        if (!deps.mediaAgent()) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
        const rawBody = await readBody(req);
        let body: string | Record<string, unknown>;
        try { body = JSON.parse(rawBody); } catch { body = rawBody; }
        const headers: Record<string, string | undefined> = {};
        for (const key of Object.keys(req.headers)) headers[key] = String(req.headers[key] ?? '');
        const result = await deps.mediaAgent()!.handleJsonRpc(body, headers);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      } catch (err: any) {
        log.error('[A2A] error:', err?.message || String(err));
        res.writeHead(500);
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    // GET /.well-known/agent-card.json — A2A agent discovery
    if (url === '/.well-known/agent-card.json' && req.method === 'GET') {
      if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
      try {
        if (!deps.mediaAgent()) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
        res.setHeader('Content-Type', 'application/a2a+json');
        res.end(JSON.stringify(deps.mediaAgent()!.agentCard));
      } catch (err: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    // GET /a2a/artifacts/<id> — task artifact download (spec §6.7 output reference)
    const artifactId = matchArtifactId(url);
    if (artifactId && req.method === 'GET') {
      if (!isLoopback) { res.writeHead(403); res.end(JSON.stringify({ error: 'forbidden' })); return; }
      try {
        if (!deps.mediaAgent()) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
        const artifact = deps.mediaAgent()!.getArtifact(artifactId);
        if (!artifact) { res.writeHead(404); res.end(JSON.stringify({ error: 'artifact not found' })); return; }
        const b64 = artifact.dataUrl.split(',')[1] || '';
        res.setHeader('Content-Type', artifact.mediaType);
        res.end(Buffer.from(b64, 'base64'));
      } catch (err: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
      return;
    }

    // MCP endpoints on /mcp — dual transport:
    //   POST with ?sessionId=... → legacy SSE message channel
    //   POST without sessionId   → stateless StreamableHTTP (MCP 2025-03-26)
    //   GET with mcp-protocol-version header → StreamableHTTP standalone
    //     stream request → 405 (we serve no standalone stream; the
    //     StreamableHTTP client treats 405 as expected and stays in
    //     JSON-response mode)
    //   GET without it → legacy SSE session establishment (old clients)
    if (pathname.startsWith("/mcp") && req.method === "POST") {
      const isLegacySsePost = new URL(url, "http://localhost").searchParams.has("sessionId");
      try {
        if (isLegacySsePost) {
          await deps.mcpEndpoint()!.handleMessage(req, res);
        } else if (deps.mcpStreamable()) {
          await deps.mcpStreamable()!.handleRequest(req, res);
        } else {
          res.writeHead(503);
          res.end(JSON.stringify({ error: "StreamableHTTP endpoint unavailable" }));
        }
      } catch (err: any) {
        log.error("[MCP Message] Error:", err.message);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
    }

    if (url === "/mcp" && req.method === "GET") {
      if (req.headers["mcp-protocol-version"]) {
        // StreamableHTTP client asking for a standalone SSE stream — we
        // run stateless JSON mode only, so decline per spec.
        res.writeHead(405, { Allow: "POST" });
        res.end();
        return;
      }
      try {
        await deps.mcpEndpoint()!.handleSSE(req, res);
      } catch (err: any) {
        log.error("[MCP SSE] Error:", err.message);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
    }

    // Dashboard SPA (HTML + assets)
    const isSPAAsset = pathname.startsWith("/assets/") || pathname.startsWith("/static/");
    if (url === "/" || isSPAAsset || url === "/index.html") {
      const publicDir = deps.spaRoot();
      if (url === "/" || url === "/index.html") {
        res.setHeader("Content-Type", "text/html");
        const indexPath = path.join(publicDir, "index.html");
        if (fs.existsSync(indexPath)) {
          res.end(fs.readFileSync(indexPath, "utf-8"));
        } else {
          res.writeHead(404);
          res.end("index.html not found");
        }
      } else {
        const assetPath = path.join(publicDir, url.replace("/static/", ""));
        if (fs.existsSync(assetPath)) {
          const ext = path.extname(assetPath);
          const mime: Record<string, string> = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
          res.setHeader("Content-Type", mime[ext] || 'application/octet-stream');
          res.end(fs.readFileSync(assetPath));
        } else {
          res.writeHead(404);
          res.end("not found");
        }
      }
      return;
    }

    // Everything else under `/api/*` is a registry route (`routes/*`) dispatched
    // above; this chain only carries transport-level branches.

    // Dashboard API
    if (pathname.startsWith("/api/goals") || pathname.startsWith("/api/stats") || pathname.startsWith("/api/memory")) {
      res.setHeader("Content-Type", "application/json");
      const dashboard = await deps.dashboardDispatch(req);
      res.writeHead(dashboard.status);
      res.end(JSON.stringify(dashboard.body));
      return;
    }

    // 插件注册：必须传递 projectDir + mafwDir
    if (url === '/register' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const intent = deps.register.parseIntent(data);
          if (!intent) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing projectDir or mafwDir' }));
            return;
          }
          const { projectDir, mafwDir, setCurrent } = intent;

          // Never register the user's home directory (or its standard data
          // folders) as a project — desktop's opencode server plugin activates
          // with cwd=$HOME (or a folder under it) and would otherwise pollute
          // the registry with bogus "projects" (and manager sessions).
          if (deps.register.isUserDataDir(projectDir)) {
            log.warn(`[Scheduler] Refusing to register user data directory as project: ${projectDir}`);
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'User data directory cannot be a project' }));
            return;
          }

          // 显式选择才允许切换当前项目；自动注册（插件激活）只登记。
          if (setCurrent && !deps.register.isSelectableProject(projectDir)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Infrastructure directory cannot be the current project' }));
            return;
          }

          const existing = deps.register.registeredProject(projectDir);
          const changed = !existing || existing.mafwDir !== mafwDir;
          deps.register.registerProject(projectDir, {
            projectDir,
            mafwDir,
            registeredAt: existing?.registeredAt ?? new Date().toISOString()
          });

          if (setCurrent) {
            // 桌面 Rail 的"切换项目"（SDK project.setCurrent）。
            deps.register.setCurrentProject(projectDir);
          }

          // 持久化到磁盘（写队列防并发覆盖）；无变化的自动注册不写盘/不广播，
          // 避免 hourly 插件注册把项目列表刷到 UI。
          if (changed || setCurrent) {
            await deps.register.persistRegistry();
            // 桌面 renderer 依此事件刷新 Rail 项目列表（否则只在 gateway ready 时拉一次）。
            deps.register.broadcastProjectRegistered(projectDir);
          }

          if (deps.register.hasRuntime()) {
            try {
              await deps.register.ensureManagerSession(projectDir, mafwDir);
            } catch (err: any) {
              log.warn(`[Scheduler] Manager session bootstrap failed: ${err.message} (non-fatal)`);
            }
          }

          log.info(`[Scheduler] Project registered: ${projectDir}`);
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', registered: projectDir }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // 控制指令（/control 为 MCP handler 兼容路径；/api/goals/control 为 SDK goals.control 契约路径，两者等价）
    if ((url === '/control' || url === '/api/goals/control') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const control = JSON.parse(body);
          log.info(`[Scheduler] HTTP control: ${control.action} ${control.goalId || ''}`);

          // 直接处理控制指令（同 processControlFile 逻辑）
          switch (control.action) {
            case 'PAUSE':
              if (control.goalId) await deps.control.patchState(control.goalId, { nextAction: 'PAUSED' });
              break;
            case 'ABORT':
              if (control.goalId) {
                await deps.control.destroyAllSessions(control.goalId);
                // W1：取消语义 = 批准门也取消（防 terminal state 下 UI 残留 pending）
                await deps.control.patchState(control.goalId, { nextAction: 'FAILED', planApproval: null });
                const state = deps.control.getActiveGoal(control.goalId);
                // Find projectDir for this goal
                let projectDir: string | null = null;
                for (const [pDir, info] of deps.control.registeredProjects()) {
                  if (fs.existsSync(path.join(info.mafwDir, 'state', `${control.goalId}.json`))) {
                    projectDir = pDir;
                    break;
                  }
                }
                if (projectDir) {
                  const { recordGoalOutcome } = await import('../orchestration/outcome-recorder.js');
                  recordGoalOutcome(deps.control.getGatewayDb(), {
                    goalId: control.goalId,
                    verdict: 'CANCELLED',
                    rounds: state?.loop ?? 0,
                    lastError: 'User cancelled',
                    reviewFeedback: null,
                    projectDir,
                    mafwDir: path.join(projectDir, '.mafw'),
                    projectId: projectDir,
                  });
                }
                await deps.control.archiveGoal(control.goalId, {
                  verdict: 'CANCELLED',
                  rounds: state?.loop ?? 0,
                  lastError: 'User cancelled',
                });
              }
              break;
            case 'FORCE_PHASE':
              if (control.goalId && control.targetPhase) {
                await deps.control.destroyAllSessions(control.goalId);
                await deps.control.patchState(control.goalId, {
                  nextAction: `CREATE_${control.targetPhase.toUpperCase()}_SESSION`
                });
              }
              break;
            case 'RESET_PARAMETRIC':
              log.info('[Scheduler] Resetting parametric cache...');
              break;
          }

          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // 健康检查
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        serveRunning: deps.health.serveRunning(),
        registeredProjects: deps.health.registeredProjectDirs(),
        activeGoals: deps.health.activeGoalIds(),
        media: { configured: deps.health.mediaConfigured() },
        ...deps.health.releaseFields(),
      }));
      return;
    }

    // GET /health — standalone health endpoint (not proxied)
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Reverse proxy to the agent backend for non-MAFW routes —
    // target from the runtime contract (getBaseUrl), config 仅 bootstrap 兜底
    const serveUrl = deps.proxyTarget();
    try {
      const proxyUrl = new URL(url || '/', serveUrl);
      const proxyReq = http.request(proxyUrl, {
        method: req.method,
        // 2.1.0：serve 强制 Basic——剔除入站 Authorization 后注入 serve 凭证
        headers: { ...injectServeAuth(req.headers, deps.proxyHeaders()), host: proxyUrl.host },
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
      });
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    } catch (err: any) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'Proxy config error: ' + err.message }));
    }
    } catch (err: any) {
      log.error('[Scheduler] Unhandled request error:', err.message);
      if (!res.headersSent) {
        try { res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
        } catch { /* response already ended */ }
      }
    }
  };
  return listener;
}
