/**
 * Phase D1 Task H2: Pod 事件（人侧查收）三条分支 → registry dispatch。
 *
 *   GET  /api/pods/:podId/events           — unread 计数 + 列表（?state=unread&limit=）
 *   POST /api/pods/:podId/events/:id/seen  — 单条已读
 *   POST /api/pods/:podId/events/seen      — 按 goal+revision 批量已读
 *
 * legacy 用一个共享块（seenAll/seenOne/list 三个正则 + 方法武装的 if）分派到
 * handlePodEvents；逐字迁移到三个按 method 拆开的 handler（automations.ts 同款
 * 分解）。podId / id 由 registry 预先 decode，故不再 decodeURIComponent（legacy
 * 的正则捕获值需要 decode，registry params 已是解码后的段）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { readRouteBody } from './cognition';
import { handlePodEvents, type PodEventsServiceLike } from './pod-events';
import type { RouteRegistry } from './registry';

export interface PodEventsRouteDeps {
  podEventService: () => PodEventsServiceLike | undefined;
}

export function attachPodsEventsRoutes(registry: RouteRegistry, deps: PodEventsRouteDeps): void {
  // GET /api/pods/:podId/events — list (+ unread count)
  registry.attachHandler('pod.events.list', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const podId = params.podId;
    const searchParams = new URL(req.url!, 'http://127.0.0.1').searchParams;
    let body: any = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readRouteBody(req)); } catch { body = {}; }
    }
    const out = await handlePodEvents({ service: deps.podEventService()! })({
      method: req.method ?? 'GET',
      podId,
      query: { state: searchParams.get('state') ?? undefined, limit: searchParams.get('limit') ?? undefined },
      body,
    });
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });

  // POST /api/pods/:podId/events/:id/seen — mark one event seen
  registry.attachHandler('pod.events.seen', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const podId = params.podId;
    const searchParams = new URL(req.url!, 'http://127.0.0.1').searchParams;
    let body: any = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readRouteBody(req)); } catch { body = {}; }
    }
    const out = await handlePodEvents({ service: deps.podEventService()! })({
      method: req.method ?? 'GET',
      podId,
      id: params.id,
      query: { state: searchParams.get('state') ?? undefined, limit: searchParams.get('limit') ?? undefined },
      body,
    });
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });

  // POST /api/pods/:podId/events/seen — mark all seen for goal+revision
  registry.attachHandler('pod.events.seenAll', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const podId = params.podId;
    const searchParams = new URL(req.url!, 'http://127.0.0.1').searchParams;
    let body: any = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readRouteBody(req)); } catch { body = {}; }
    }
    const out = await handlePodEvents({ service: deps.podEventService()! })({
      method: req.method ?? 'GET',
      podId,
      action: 'seenAll' as const,
      query: { state: searchParams.get('state') ?? undefined, limit: searchParams.get('limit') ?? undefined },
      body,
    });
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
}
