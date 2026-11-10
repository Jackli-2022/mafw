/**
 * Phase D1 Task B2: usage 聚合面（registry dispatch 接线）。
 *
 *   GET /api/usage          — consolidated usage（summary + memory + modelStats + providers）
 *   GET /api/usage/summary  — backward compat alias（summary + memory）
 *
 * handler 体从 index.ts legacy 分支逐字迁移；两者都是 fail-open 200（查询失败也回
 * 200 + 零值载荷），provider poll 仍按请求实时调用。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { buildModelStats, ModelUsageWindows } from '../usage/model-stats';
import type { RouteRegistry } from './registry';
import type { TrajectoryStore } from '../trajectory/trajectory-store';
import type { UsagePoller } from '../usage/usage-poller';

export interface UsageRouteDeps {
  trajectoryStore: () => TrajectoryStore | null;
  usagePoller: () => UsagePoller | null;
}

export function attachUsageRoutes(registry: RouteRegistry, deps: UsageRouteDeps): void {
  // GET /api/usage?sessionID=xxx&projectID=xxx — consolidated usage (summary + providers)
  registry.attachHandler('session.usage', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const sessionID = parsedUrl.searchParams.get('sessionID') || '';
      const projectID = parsedUrl.searchParams.get('projectID') || '';
      const store = deps.trajectoryStore();
      const empty = { totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, sessionCount: 0 };
      const summary: any = { session: { ...empty, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, project: { ...empty }, global: { ...empty } };
      if (store) {
        if (sessionID) summary.session = store.getSessionTokenSummary(sessionID);
        if (projectID) summary.project = store.getProjectTokenSummary(projectID);
        summary.global = store.getGlobalTokenSummary();
      }
      const memory = store ? store.getMemoryTokenSummary() : null;
      let modelStats: ModelUsageWindows = { today: [], '7d': [], '30d': [], all: [] };
      if (store) {
        try {
          modelStats = buildModelStats(store);
        } catch (err: any) {
          log.warn(`[Usage] modelStats failed: ${err.message}`);
        }
      }
      const poller = deps.usagePoller();
      const providerData = poller ? await poller.poll() : { providers: [], updatedAt: Date.now() };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary, memory, modelStats: { windows: modelStats }, ...providerData }));
    } catch (err: any) {
      log.warn(`[Usage] failed: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary: null, providers: [], updatedAt: Date.now() }));
    }
  });

  // GET /api/usage/summary — backward compat alias
  registry.attachHandler('session.usageSummary', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const sessionID = parsedUrl.searchParams.get('sessionID') || '';
      const projectID = parsedUrl.searchParams.get('projectID') || '';
      const store = deps.trajectoryStore();
      const empty = { totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, totalCost: 0, turnCount: 0, sessionCount: 0 };
      const result: any = { session: { ...empty, avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, project: { ...empty }, global: { ...empty } };
      if (store) {
        if (sessionID) result.session = store.getSessionTokenSummary(sessionID);
        if (projectID) result.project = store.getProjectTokenSummary(projectID);
        result.global = store.getGlobalTokenSummary();
      }
      const memory = store ? store.getMemoryTokenSummary() : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, memory }));
    } catch (err: any) {
      log.warn(`[UsageSummary] failed: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ session: null, project: null, global: null }));
    }
  });
}
