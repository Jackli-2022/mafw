/**
 * Phase D1 Task H2: GET /api/manager/session → registry dispatch（manager.session）。
 *
 * handler 体从 index.ts legacy 分支逐字迁移：?projectDir= 过滤单项目（未知项目
 * 404 {error:'No manager session for project'}），无过滤时按 kv 全部 manager-session
 * 键经 live registry 投影（空 → 404 {error:'No manager session'}），异常 500
 * {error:'Failed to read manager sessions'} + log.warn 原样保留。
 *
 * legacy 是 `req.url.startsWith('/api/manager/session')` 的盲点分支（无 `?.`，不
 * 进 analyzer 统计）；registry 只接管精确 GET /api/manager/session。
 * 兄弟路由 POST /api/manager/session/rotate 已在 wave1 attach（manager.rotate）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { canonicalProjectDir } from '../core/pod/pod-identity';
import type { LeadSessionRegistry } from '../core/manager/lead-session-registry';
import type { RouteRegistry } from './registry';

export interface ManagerSessionRouteDeps {
  leadSessionRegistry: () => LeadSessionRegistry;
  getGatewayDb: () => { kvAll(scope: string): Array<{ key: string }> };
}

export function attachManagerSessionRoutes(registry: RouteRegistry, deps: ManagerSessionRouteDeps): void {
  registry.attachHandler('manager.session', async (req: IncomingMessage, res: ServerResponse) => {
    const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const filter = parsedUrl.searchParams.get('projectDir') || '';
    try {
      if (filter) {
        const current = deps.leadSessionRegistry().current(filter);
        if (!current) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'No manager session for project' }));
          return;
        }
        res.writeHead(200);
        res.end(
          JSON.stringify({
            projectDir: canonicalProjectDir(filter),
            sessionId: current.sessionId,
            createdAt: current.createdAt ?? null,
          }),
        );
        return;
      }
      // Per-runtime slots: surface only the ACTIVE runtime's Lead per
      // canonical project. Dormant runtimes and raw-key variants are
      // resolved through the same lifecycle reader, never duplicated.
      const all = deps.getGatewayDb().kvAll('manager-session');
      const projectDirs = new Set(all.map((entry) => canonicalProjectDir(entry.key)));
      const live = Array.from(projectDirs)
        .map((projectDir) => ({ projectDir, current: deps.leadSessionRegistry().current(projectDir) }))
        .filter((entry): entry is { projectDir: string; current: NonNullable<typeof entry.current> } => !!entry.current);
      if (live.length === 0) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'No manager session' }));
        return;
      }
      res.writeHead(200);
      res.end(
        JSON.stringify(
          live.map((entry) => ({
            projectDir: entry.projectDir,
            sessionId: entry.current.sessionId,
            createdAt: entry.current.createdAt ?? null,
          })),
        ),
      );
    } catch (err: any) {
      log.warn(`[Scheduler] /api/manager/session failed: ${err.message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to read manager sessions' }));
    }
  });
}
