/**
 * Phase D1 Task E1: sessions 读模型面（registry dispatch 接线）。
 *
 *   GET /api/sessions/:id/messages      — flat MAFW 历史（委托 routes/session-history.ts）
 *   GET /api/sessions/:id/todo          — 会话 todo 列表（runtime 缺失/抛错 → fail-open 200 {data:[]}）
 *   GET /api/sessions/:id/trajectory    — agent 轨迹时间线（store 缺失 → {turns:[],events:[]}）
 *   GET /api/sessions/:id/token-summary — 会话 token/成本汇总（store 缺失 → 零值汇总）
 *   GET /api/sessions/:id/children      — 本回合子会话（depth 由 subagentService 补齐）
 *
 * handler 体从 index.ts legacy 分支逐字迁移（`this.x` → `deps.x()`），五个读模型全部
 * 保留「永远 200、失败回空壳」的 legacy 语义（不是 404 / 500）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { handleSessionHistory } from './session-history';
import type { RouteRegistry } from './registry';

export interface SessionsReadRouteDeps {
  runtime: () => any;
  trajectoryStore: () => any;
  projectDir: () => string | undefined;
  listDataParts: (sessionID: string, messageIds: string[]) => any;
  subagentService: () => any;
}

export function attachSessionsReadRoutes(registry: RouteRegistry, deps: SessionsReadRouteDeps): void {
  // GET /api/sessions/{id}/messages — flat MAFW history（默认且唯一出口）
  // 委托返回的 boolean 原样上抛：registry match() 会剥尾斜杠，而 handleSessionHistory
  // 自己的正则不会 —— false 时 dispatchAuthorized 才回退 legacy 链，吞掉会挂住请求。
  registry.attachHandler('session.messages', (req, res) =>
    handleSessionHistory(req, res, req.url!, {
      getRuntime: () => deps.runtime(),
      listDataParts: (sessionID, messageIds) =>
        deps.listDataParts(sessionID, messageIds),
      warn: (message) => log.warn(message),
    }));

  // GET /api/sessions/{id}/todo —fetch session todo list (task panel)
  registry.attachHandler('session.todo', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    try {
      if (!deps.runtime()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      const result = await deps.runtime().session.todo({ sessionID: id });
      const rawData = Array.isArray(result) ? result : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: Array.isArray(rawData) ? rawData : [] }));
    } catch (err: any) {
      log.warn(`[Scheduler] Failed to fetch todos for ${id}: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    }
  });

  // GET /api/sessions/{id}/trajectory —agent trajectory timeline (task/desktop)
  registry.attachHandler('session.trajectory', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const limit = Math.min(parseInt(parsedUrl.searchParams.get('limit') || '50', 10), 200);
      const beforeTurn = parsedUrl.searchParams.get('before_turn') ? Number(parsedUrl.searchParams.get('before_turn')) : undefined;
      const rebuild = parsedUrl.searchParams.get('rebuild') === '1';
      const store = deps.trajectoryStore();
      if (!store) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ turns: [], events: [] }));
        return;
      }
      if (rebuild) {
        try {
          const result = await deps.runtime()?.session.messages({ sessionID: id, limit: 200 });
          const data = result?.data || [];
          const messages = Array.isArray(data) ? data : [];
          const { handleTrajectoryRequest } = require('../trajectory/api') as typeof import('../trajectory/api');
          const out = await handleTrajectoryRequest({ store, sessionID: id, opts: { limit, beforeTurn, rebuild }, messages: { data: messages }, projectID: deps.projectDir() || '.' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(out));
          return;
        } catch (err: any) {
          log.warn(`[Trajectory] rebuild failed (non-fatal): ${err.message}`);
        }
      }
      const { handleTrajectoryRequest } = require('../trajectory/api') as typeof import('../trajectory/api');
      const out = await handleTrajectoryRequest({ store, sessionID: id, opts: { limit, beforeTurn } });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (err: any) {
      log.warn(`[Trajectory] fetch failed (non-fatal): ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ turns: [], events: [] }));
    }
  });

  // GET /api/sessions/{id}/token-summary — per-session token/cost totals
  registry.attachHandler('session.tokenSummary', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    try {
      const store = deps.trajectoryStore();
      if (!store) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
        return;
      }
      const summary = store.getSessionTokenSummary(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(summary));
    } catch (err: any) {
      log.warn(`[TokenSummary] fetch failed: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }));
    }
  });

  // GET /api/sessions/{id}/children —subagent sessions of this run (AgentPicker)
  registry.attachHandler('session.children', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    try {
      if (!deps.runtime()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      const result = await deps.runtime().session.children({ sessionID: id });
      const items = Array.isArray(result) ? result : [];
      const parentDepth = await deps.subagentService().depthOf(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: items.map((item: any) => ({
        ...item,
        depth: typeof item?.depth === 'number' ? item.depth : parentDepth + 1,
      })) }));
    } catch (err: any) {
      log.warn(`[Scheduler] Failed to fetch children for ${id}: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [] }));
    }
  });
}
