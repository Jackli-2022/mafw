/**
 * Phase D1 Task D1: sessions core 面（registry dispatch 接线）。
 *
 *   POST   /api/session                    — 创建会话（worktree 归属门，委托 routes/session-create.ts）
 *   GET    /api/sessions/:id               — 会话详情（缺失 → 200 {error:'not found'}，不是 404）
 *   DELETE /api/session/:id                — 旧删除面（cleanup 集合与 session.delete 不同，R4）
 *   POST   /api/session/:id/abort          — 中止在途回合
 *   POST   /api/session/:id/background     — 转后台（委托 routes/session-background.ts）
 *   POST   /api/session/:id/promptAsync    — fire-and-forget prompt（double-parse 逐字保留）
 *   POST   /api/session/:id/prompt         — 同步 prompt（暂停 → 409）
 *   GET    /api/session/:id/queue          — 会话队列快照
 *   DELETE /api/session/:id/queue          — 清空队列（emitQueueUpdated 'clear'）
 *   DELETE /api/session/:id/queue/:itemId  — 取消单条（404 miss + emitQueueUpdated 'cancel'）
 *
 * handler 体从 index.ts legacy 分支逐字迁移（`this.x` → `deps.x()`）；body 解析沿用
 * index 的单次 readBody（readRouteBody）。promptAsync 的二次 JSON.parse 是 legacy 既有
 * 行为，逐字保留。R2：五个 `$`-only 正则迁 registry 后对 query 不敏感（已接受）。
 * R4：deleteLegacy 与 session.delete 的 cleanup 集合不同，各自逐字保留、不合并。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { projectSession } from '../runtime/view-projections';
import { resolveWorktreeAvailability, probeGitWorktreeSupport } from '../core/worktree/worktree-availability';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';
import { handleSessionCreate } from './session-create';
import { handleSessionBackground } from './session-background';

/** 与 index.ts L233 同一词表（index-local const，不可跨模块 import）。 */
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const isThinkingLevel = (v: unknown): v is string => typeof v === 'string' && THINKING_LEVELS.has(v);

export interface SessionsCoreRouteDeps {
  getGatewayDb: () => GatewayDatabase;
  resolvedProjectDir: () => string;
  sdkSession: () => any;
  runtime: () => any;
  podService: () => any;
  instructionSync: () => any;
  discovery: () => any;
  trajectoryStore: () => any;
  identityRegistry: () => any;
  identityState: () => any;
  runCoordinator: () => any;
  busySessions: () => { has(sessionID: string): boolean };
  sessionQueue: () => any;
  enqueueQueuedPrompt: (opts: any, source: string) => Promise<any>;
  attachBudgetGuardForPrompt: (sessionID: string, maxTurns?: number, maxCostUsd?: number) => void;
  emitQueueUpdated: (sessionID: string, kind: 'enqueue' | 'dequeue' | 'cancel' | 'clear' | 'expire', items: any[], itemId?: string) => void;
}

export function attachSessionsCoreRoutes(registry: RouteRegistry, deps: SessionsCoreRouteDeps): void {
  // POST /api/session — create a session（worktree 归属门在 routes/session-create.ts）
  registry.attachHandler('session.create', async (req, res) => {
    await handleSessionCreate(req, res, {
      kvGet: (key, id) => deps.getGatewayDb().kvGet<any>(key, id),
      kvSet: (key, id, v) => deps.getGatewayDb().kvSet(key, id, v),
      kvDel: (key, id) => deps.getGatewayDb().kvDelete(key, id),
      // 目录必填：缺省时回退到 gateway 的单点解析（绝对路径）
      createSession: (directory, metadata) => deps.sdkSession().create(directory ?? deps.resolvedProjectDir(), metadata),
      // worktree 归属（设计 §7.1）：gateway git + session.create({directory}) 契约，
      // 不再按 runtime 私有 worktreeApi 能力位拒绝支持的 runtime。
      worktreeAvailability: async (directory) => {
        let directorySupported = false;
        try {
          directorySupported = deps.runtime()?.access?.can('session.worktree') === true;
        } catch { /* unknown surface → unsupported */ }
        return resolveWorktreeAvailability({
          directory,
          directorySupported,
          gitAvailable: await probeGitWorktreeSupport(directory),
        });
      },
    });
  });

  // GET /api/sessions/{id} —get session via SDK (with local fallback)
  registry.attachHandler('session.get', async (_req, res, params) => {
    try {
      const id = params.id;
      if (deps.runtime()) {
        try {
          const session = await deps.runtime().session.get({ sessionID: id });
          if (session) { res.writeHead(200); res.end(JSON.stringify(projectSession(session))); return; }
        } catch {}
      }
      const session = await deps.sdkSession().get(id);
      res.writeHead(200);
      res.end(JSON.stringify(session ? projectSession(session) : { error: 'not found' }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // DELETE /api/session/{id} — delete a session
  registry.attachHandler('session.deleteLegacy', async (_req, res, params) => {
    try {
      const sessionID = params.id;
      try {
        await deps.podService()?.snapshotSession(sessionID);
      } catch {
        deps.podService()?.finalizeMissingSession(sessionID);
      }
      await deps.sdkSession().delete(sessionID);
      deps.instructionSync()?.forget(sessionID);
      deps.discovery()?.forget(sessionID);
      try { deps.trajectoryStore()?.deleteSession(sessionID); } catch (err: any) { log.warn(`[Trajectory] delete failed: ${err.message}`); }
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // POST /api/session/{id}/abort —abort an in-flight run
  registry.attachHandler('session.abort', async (_req, res, params) => {
    try {
      const sessionID = params.id;
      if (!deps.runtime()) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'LLM client not available' }));
        return;
      }
      await deps.runtime().session.abort({ sessionID });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // Background 面自动词（兼容早期 serve 透传入口）
  // 委托的 boolean 必须原样上抛：false（URL 形状不匹配，如尾随斜杠——registry
  // match() 会剥尾斜杠而模块内正则不会）时 dispatchAuthorized 才回退 legacy 链；
  // 吞掉 false 会让请求既不写响应也不落回退（客户端挂起）。
  registry.attachHandler('session.background', async (req, res) =>
    handleSessionBackground(req, res, req.url!, {
      getRuntime: () => deps.runtime(),
      getAccess: () => deps.runtime()?.access ?? null,
    }));

  // POST /api/session/{id}/promptAsync — fire-and-forget prompt
  registry.attachHandler('session.promptAsync', async (req, res, params) => {
    try {
      const sessionID = params.id;
      const body = await readRouteBody(req);
      const { message, parts, agent, model, maxTurns, maxCostUsd, delivery, idempotencyKey, expectReply, thinkingLevel, variant, outputSchema } = body ? JSON.parse(body) : {};
      if (!message && !Array.isArray(parts)) { res.writeHead(400); res.end(JSON.stringify({ error: 'message or parts required' })); return; }
      if (thinkingLevel !== undefined && !isThinkingLevel(thinkingLevel)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: `invalid thinkingLevel: ${String(thinkingLevel)}` }));
        return;
      }
      // Identity-aware (spec §3.2): picking a registry identity binds it for
      // this turn — the policy layer evaluates the turn's tool calls against it.
      // The agent param itself is injected/stripped by withIdentityPrompt at the runtime.
      if (agent && deps.identityRegistry().get(agent)) {
        deps.identityState().bind(sessionID, agent, 'turn');
      }
      // 队列交付（spec §5.3）：busy + delivery:'queue' → 入队短路响应。
      // 终审 #4：budget 字段与 queue/暂停入队组合无强制语义（guard 只护当前回合，flush 后无保护）——显式 400 拒绝。
      const holdsQueue = deps.runCoordinator()?.shouldHoldQueue(sessionID) === true;
      if ((delivery === 'queue' || holdsQueue) && (typeof maxTurns === 'number' || typeof maxCostUsd === 'number')) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'queued/suspended send cannot carry maxTurns/maxCostUsd (budget guards the current turn only)' }));
        return;
      }
      // 暂停中（T2-2）一律入队：会话已 idle，普通直发会绕过暂停。
      if (holdsQueue || (delivery === 'queue' && deps.busySessions().has(sessionID))) {
        try {
          const parsedBody = body ? JSON.parse(body) : {};
          const q = await deps.enqueueQueuedPrompt({
            sessionID, text: message, parts, agent, model, idempotencyKey,
            ...(parsedBody.expectReply !== undefined ? { expectReply: parsedBody.expectReply } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            ...(variant ? { variant } : {}),
          }, 'http');
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', ...q }));
        } catch (qerr: any) {
          res.writeHead(qerr?.statusCode ?? 500);
          res.end(JSON.stringify({ error: qerr.message }));
        }
        return;
      }
      // P0-2：per-prompt 预算（guard 须先于 promptAsync 挂载——step 事件在回合执行中流出；
      // 放在队列短路口之后：入队/暂停分支不挂 guard）。
      deps.attachBudgetGuardForPrompt(sessionID, maxTurns, maxCostUsd);
      await deps.sdkSession().promptAsync(sessionID, message, parts, agent, model, outputSchema, {
        ...(delivery ? { delivery } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(expectReply !== undefined ? { expectReply } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        ...(variant ? { variant } : {}),
      });
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // POST /api/session/{id}/prompt — synchronous prompt
  registry.attachHandler('session.prompt', async (req, res, params) => {
    try {
      const sessionID = params.id;
      if (deps.runCoordinator()?.shouldHoldQueue(sessionID)) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: 'session is suspended; resume or discard the run first' }));
        return;
      }
      const body = await readRouteBody(req);
      const opts = body ? JSON.parse(body) : {};
      if (opts.thinkingLevel !== undefined && !isThinkingLevel(opts.thinkingLevel)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: `invalid thinkingLevel: ${String(opts.thinkingLevel)}` }));
        return;
      }
      const result = await deps.sdkSession().prompt(sessionID, opts.parts || [], opts.system, opts.outputSchema, {
        ...(opts.thinkingLevel ? { thinkingLevel: opts.thinkingLevel } : {}),
        ...(opts.variant ? { variant: opts.variant } : {}),
      });
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // ── 会话队列 inbox 管理面（spec 2026-10-22-session-queue-inbox §5.5）──
  // GET /api/session/{id}/queue — 列队
  registry.attachHandler('session.queue.list', async (_req, res, params) => {
    const sessionID = params.id;
    res.writeHead(200);
    res.end(JSON.stringify({ items: deps.sessionQueue().list(sessionID) }));
  });
  // DELETE /api/session/{id}/queue — 清空
  registry.attachHandler('session.queue.clear', async (_req, res, params) => {
    const sessionID = params.id;
    const cleared = deps.sessionQueue().clear(sessionID);
    deps.emitQueueUpdated(sessionID, 'clear', deps.sessionQueue().list(sessionID));
    res.writeHead(200);
    res.end(JSON.stringify({ cleared: cleared.length }));
  });
  // DELETE /api/session/{id}/queue/{itemId} — 取消单条
  registry.attachHandler('session.queue.cancel', async (_req, res, params) => {
    const sessionID = params.id;
    const itemId = params.itemId;
    const cancelled = deps.sessionQueue().cancel(sessionID, itemId);
    if (!cancelled) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: `queue item not found: ${itemId}` }));
      return;
    }
    deps.emitQueueUpdated(sessionID, 'cancel', deps.sessionQueue().list(sessionID), itemId);
    res.writeHead(200);
    res.end(JSON.stringify({ cancelled: itemId }));
  });
}

export type { IncomingMessage, ServerResponse };
