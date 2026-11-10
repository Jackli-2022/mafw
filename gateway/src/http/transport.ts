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
import { serveAuthHeaders } from '../runtime/serve-sidecar';
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

    // GET /api/media/resolve-task/:id — Phase D1 Task C4：已迁 registry dispatch
    // （loopback 门随迁，见 routes/media-upload.ts）。

    // GET /api/tts/voices — 当前引擎音色 + 能力（desktop picker）
    // GET /api/voice/status — voice config + registered ASR engines.
    // GET /api/voice/status — Phase D1 Task H1：已迁 registry dispatch。

    // /api/tts/voices + POST /api/tts + /api/tts/stream + /api/tts/interrupt
    // — Phase D1 Task 3c：已迁 registry dispatch（attachTtsRoutes；voices/speak
    // 无 loopback 门、stream/interrupt 有——语义逐字等价）。

    // POST /api/media/analyze-audio — Phase D1 Task 3e：已迁 registry dispatch。
    // POST /api/media/upload — Phase D1 Task 3e：已迁 registry dispatch。

    // POST /api/media/create-task — Phase D1 Task 3e：已迁 registry dispatch。

    // POST /api/media/upload-and-create — Phase D1 Task 3e：已迁 registry dispatch。

    // Mobile TTS artifact + media proxy — Phase D1 Task 3d：已迁 registry dispatch。

    // POST /api/tts/stream + POST /api/tts/interrupt — Phase D1 Task 3c：
    // 已迁 registry dispatch（attachTtsRoutes；loopback 门随迁）。

    // POST /api/python/execute + restart + status — Phase D1 Task 3a：
    // 已迁 registry dispatch（attachPythonRoutes；loopback 守卫随迁）。

    // GET /api/tools + POST /api/tools/execute — Phase D1 Task 3b：
    // 已迁 registry dispatch（attachToolsRoutes；loopback 守卫随迁）。

    // GET /api/python/status — kernel status for a session — Phase D1 Task 3a：
    // 已迁 registry dispatch。

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

    // Chat API + POST /api/chat/enriched — Phase D1 Task C2：已迁 registry dispatch。

    // POST /api/mafw-commands/run + GET /api/mafw-commands — Phase D1 Task A2：已迁 registry dispatch。
    // POST /api/merge-memory — Phase D1 Task A3：已迁 registry dispatch。

    // GET /api/memory/{merged-search,stats,sticky,get,search,energy-distribution} + POST /api/memory/embeddings/backfill
    // + DELETE /api/memory/{id} + GET /api/l5/axioms — Phase D1 Task F1：已迁 registry dispatch。
    // POST /api/goals/{goalId}/questions/{questionId}/respond — Phase D1 Task F2：已迁 registry dispatch。
    // GET /api/goals/:id/sessions — P5 Wave 1 起由 registry dispatch 接管
    // （历史约束"须挂 Dashboard /api/goals* 兜底之前"由 dispatch 位置满足）。

    // GET /api/goals/:id/source — registry route `goals.source` (handoff provenance + full text).
    // GET /api/goals/:id/timeline — Phase D1 Task F2：已迁 registry dispatch。
    // POST /api/goals/:id/nodes/:runId/retry — Phase D1 Task F2：已迁 registry dispatch。
    // GET /api/goals/:id/plan + POST /api/goals/:id/plan-approval — Phase D1 Task F2：已迁 registry dispatch。
    // GET /api/pods/:podId/events + POST .../events/:id/seen + POST .../events/seen
    // — Phase D1 Task H2：已迁 registry dispatch（pod.events.list / seen / seenAll）。

    // 跨项目常驻存在感（tray/taskbar 的唯一数据源）。
    // GET /api/presence — Phase D1 Task H1：已迁 registry dispatch。

    // POST /api/session/{id}/background — Phase D1 Task D1：已迁 registry dispatch。

    // Neutral terminal PTY façade — Phase D1 Task 3d：已迁 registry dispatch。

    // MCP 管理门面（runtime-neutral）+ MCP 配置写入（mcpConfigApi）
    // — Phase D1 Task H2：已迁 registry dispatch（mcp.servers / connect /
    // disconnect / configPreview / configPreviewRemove / configApply /
    // configRestore / configRemove；委派 handleMcp / handleMcpConfig 不变）。

    // Dashboard API
    if (pathname.startsWith("/api/goals") || pathname.startsWith("/api/stats") || pathname.startsWith("/api/memory")) {
      res.setHeader("Content-Type", "application/json");
      const dashboard = await deps.dashboardDispatch(req);
      res.writeHead(dashboard.status);
      res.end(JSON.stringify(dashboard.body));
      return;
    }

    // POST /api/eval/chat/completions — EvalScope adapter: OpenAI-compatible
    // endpoint that drives a full main-agent run (media → agent → A2A →
    // MediaAgent → multimodal model) and returns the final answer.
    // POST /api/eval/chat/completions — Phase D1 Task H1：已迁 registry dispatch。

    // GET /api/config —gateway effective config
    // GET /api/config — Phase D1 Task H1：已迁 registry dispatch。

    // PUT /api/config — Phase D1 Task H1：已迁 registry dispatch。

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

    // POST /api/work/{goalId}/validate + POST /api/work/{goalId}/complete — Phase D1 Task F2：已迁 registry dispatch。
    // POST /api/manager/session/rotate — P5 Wave 1 起由 registry dispatch 接管
    // GET /api/manager/session — Phase D1 Task H2：已迁 registry dispatch
    // （manager.session；?projectDir= 单项目 / 全量投影语义随迁）。

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

    // GET /api/projects + GET /api/projects/current — Phase D1 Task A1：已迁 registry dispatch。

    // POST /api/devices + GET /api/devices + DELETE /api/devices/:id
    // — Phase D1 Task H2：已迁 registry dispatch（devices.register / list / delete）。
    // GET/DELETE /api/mobile/devices(:id) + POST /api/mobile/devices/register
    // + GET /api/mobile/pairing-code + POST /api/mobile/pairing/verify
    // — Phase D1 Task H2：已迁 registry dispatch（mobile.devicesList / devicesDelete /
    // devicesRegister / pairingCode / pairingVerify；配对令牌与 429 语义随迁）。
    // GET /api/approvals + POST /api/approvals/:id/respond — Phase D1 Task A5：已迁 registry dispatch。

    // GET /api/questions + POST /api/questions/:id/{reply,reject} — Phase D1 Task B1：已迁 registry dispatch。

    // 鈹€鈹€ Provider & Agents (composer model pill / @agent mention) 鈹€鈹€

    // ── /api/runtime routes — P5 Wave 2 起由 registry dispatch 接管
    // （runtimeDeps/restartAgentDeps 构造上移至私有方法；内联块对未知
    //   /api/runtime/* 悬空 return 吞请求的行为随之终结——现落回 legacy 链）

    // ── Plugin Hub (all four plugin types) — P5 Wave 2 起由 registry dispatch
    // 接管（pluginHubDeps 构造上移至私有方法；cleanupExamples 改为命中
    // /api/plugins 路由时才执行——内联时代每个到达此处的请求都跑）。

    // GET /api/orchestration/outcomes — goal outcome query
    // GET /api/orchestration/outcomes — Phase D1 Task H1：已迁 registry dispatch。

    // GET /api/provider – list providers + models (legacy /provider)
    // GET /api/provider — Phase D1 Task H1：已迁 registry dispatch。

    // GET /api/agents — Phase D1 Task H1：已迁 registry dispatch。

    // ── Runtime config (Settings page — runtime-neutral config surface) ──

    // GET/PATCH /api/runtime-config — Phase D3 Task 2：已迁 registry dispatch。
    // （routes/runtime-config.ts；GET 包络 `{ config }` / PATCH `{ status:'ok',
    // config }`、provider.config(.update) 门、503 'LLM client not available'
    // 与 500 日志格式随迁，runtime / runtimeHost 经 live getter。）

    // GET|POST /api/sessions/{sid}/permission-mode — Phase D1 Task E2：已迁 registry dispatch。

    // /api/approvals/allowlist + /api/approvals/rules (GET/POST/DELETE) — Phase D1 Task A5：已迁 registry dispatch。

    // POST /api/permissions/{id}/reply — Phase D1 Task B1：已迁 registry dispatch。

    // GET /api/triage + POST /api/triage/:id/{confirm,reject,propose} — Phase D1 Task A4：已迁 registry dispatch。

    // ── Automation endpoints (Tier 4 — user only) ──
    // POST /api/automations/draft — Phase D1 Task C1：已迁 registry dispatch。
    // GET /api/automations — Phase D1 Task C1：已迁 registry dispatch。
    // GET /api/automations/:id — Phase D1 Task C1：已迁 registry dispatch。
    // PUT /api/automations/:id — Phase D1 Task C1：已迁 registry dispatch。
    // DELETE /api/automations/:id — Phase D1 Task C1：已迁 registry dispatch。
    // GET /api/automations/:id/history — Phase D1 Task C1：已迁 registry dispatch。

    // POST /api/llm/compress — LLM compression proxy (via SDK)
    // POST /api/llm/compress — Phase D1 Task H1：已迁 registry dispatch（handleCompress 经 compress 依赖桥接）。

    // 鈹€鈹€ SdkSessionResource REST endpoints 鈹€鈹€

    // POST /api/session — Phase D1 Task D1：已迁 registry dispatch。

    // POST /api/session/{id}/promptAsync — Phase D1 Task D1：已迁 registry dispatch。

    // POST /api/session/{id}/prompt — Phase D1 Task D1：已迁 registry dispatch。

    // DELETE /api/session/{id} — Phase D1 Task D1：已迁 registry dispatch。

    // POST /api/session/{id}/abort — Phase D1 Task D1：已迁 registry dispatch。

    // ── 认知面 HTTP 动词（spec 2026-10-22-cognition-gate-rewrite §5.4；loopback-only）──
    // Phase D1 Task 2：已迁 registry dispatch（attachCognitionRoutes；loopback
    // 守卫与 per-request config 读取随 handler 迁移，行为等价）。

    // ── 会话队列 inbox 管理面（spec 2026-10-22-session-queue-inbox §5.5）──
    // GET /api/session/{id}/queue — Phase D1 Task D1：已迁 registry dispatch。
    // DELETE /api/session/{id}/queue — Phase D1 Task D1：已迁 registry dispatch。
    // DELETE /api/session/{id}/queue/{itemId} — Phase D1 Task D1：已迁 registry dispatch。

    // DELETE/PATCH /api/sessions/:id — P5 Wave 1 起由 registry dispatch 接管

    // GET /api/sessions —— code-first P0 起由 registry typed handler 接管
    // （attachTypedRoute('session.list')，schema 见 routes/schemas/session.ts）。

    // POST /api/sessions/{id}/permissions/{requestId} — Phase D1 Task E2：已迁 registry dispatch
    // （always 持久规则沉淀与 permissionList 反查 fail-open 随迁）。

    // GET /api/sessions/{id} — Phase D1 Task D1：已迁 registry dispatch。

    // GET /api/sessions/{id}/messages — Phase D1 Task E1：已迁 registry dispatch。

    // GET /api/sessions/{id}/todo — Phase D1 Task E1：已迁 registry dispatch（fail-open 200 {data:[]}）。

    // GET /api/sessions/{id}/trajectory — Phase D1 Task E1：已迁 registry dispatch
    // （store 缺失 / 抛错 → fail-open 200 {turns:[],events:[]}；rebuild 懒 require 随迁）。

    // GET /api/sessions/{id}/token-summary — Phase D1 Task E1：已迁 registry dispatch
    // （store 缺失 / 抛错 → fail-open 200 零值汇总）。

    // /api/usage/plugins* — P5 Wave 1 起由 registry dispatch 接管（7 条）

    // GET /api/media/plugins — media engine plugin state list
    // GET /api/media/plugins — Phase D1 Task H1：已迁 registry dispatch。

    // POST /api/media/plugins/reload — Phase D1 Task H1：已迁 registry dispatch。

    // POST /api/media/switch — P5 Wave 1 起由 registry dispatch 接管

    // GET/POST /api/model-config — P5 Wave 1 起由 registry dispatch 接管

    // POST /api/sessions/:id/fork|revert|unrevert + /api/session/:id/summarize
    // — P5 Wave 1 起由 registry dispatch 接管

    // GET /api/usage + GET /api/usage/summary — Phase D1 Task B2：已迁 registry dispatch。

    // ── Subagent spawn/list/message/cancel/result — Phase D1 Task E2：已迁 registry dispatch。
    // （legacy 共享 matcher 的 GET/POST 双 method 臂由 catalog method 维度拆分。）

    // GET /api/sessions/{id}/children — Phase D1 Task E1：已迁 registry dispatch
    // （runtime 缺失 / 抛错 → fail-open 200 {items:[]}；depth 补齐随迁）。

    // GET /api/recall/context — Phase D1 Task B4：已迁 registry dispatch（逐字迁移，fail-open 200）。

    // GET /api/recall/{instructions,pinned,priors} — Phase D1 Task B3：已迁 registry dispatch。

    // GET /api/agent/capabilities — Phase D1 Task 3d：已迁 registry dispatch
    // （attachAgentRoutes；fail-open 语义随迁）。

    // POST /api/obs/capture — Phase D1 Task C3：已迁 registry dispatch
    // （手动 chunked reader / 1MB 静默丢弃 / fail-open 200 逐字随迁）。

    // POST /api/events — P5 Wave 1 起由 registry dispatch 接管

    // SSE 事件（→ Dashboard / Chat）— Phase D1 Task H2：已迁 registry dispatch
    // （event.subscribe；Mode A 全局流 + 持久回放 / Mode B chat session 订阅随迁）。

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
        headers: { ...injectServeAuth(req.headers, serveAuthHeaders()), host: proxyUrl.host },
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
