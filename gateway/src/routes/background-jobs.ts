/**
 * Task 3：background jobs REST 面（中性 jobs façade）。
 *
 *   GET  /api/background/jobs?sessionID=
 *   GET  /api/background/jobs/:id/output?sessionID=&cursor=
 *   POST /api/background/jobs/:id/cancel?sessionID=
 *
 * 出口只有 `MafwBackgroundJob` / `MafwBackgroundOutput`：runtime 原生 shell DTO
 * 由 `BackgroundJobService` 在 gateway 内消化（§7.3「不直接暴露 runtime shell DTO」）。
 */
import * as http from 'http';
import type { BackgroundJobService } from '../core/background/background-jobs';
import type { RouteRegistry } from './registry';

export interface BackgroundJobsRouteDeps {
  service: Pick<BackgroundJobService, 'list' | 'output' | 'cancel'> | null | undefined;
}

/**
 * 绑定 catalog 的三条 background 路由（gateway 唯一接线点）。
 *
 * 单独导出而非内联在 index.ts：operationId ↔ handler 的挂载必须可测
 * （与 `attachPodHandlers` 同一先例——漏挂会让路由静默 404）。
 */
export function attachBackgroundJobHandlers(
  registry: RouteRegistry,
  deps: () => BackgroundJobsRouteDeps,
): void {
  registry.attachHandler('background.jobs.list', async (req, res) =>
    handleBackgroundJobsList(req, res, req.url || '', deps()));
  registry.attachHandler('background.jobs.output', async (req, res) =>
    handleBackgroundJobOutput(req, res, req.url || '', deps()));
  registry.attachHandler('background.jobs.cancel', async (req, res) =>
    handleBackgroundJobCancel(req, res, req.url || '', deps()));
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function fail(res: http.ServerResponse, err: any): void {
  const status = typeof err?.status === 'number' ? err.status : 500;
  json(res, status, { error: err?.message ?? String(err) });
}

function searchOf(url: string): URLSearchParams {
  const at = url.indexOf('?');
  return at < 0 ? new URLSearchParams() : new URLSearchParams(url.slice(at + 1));
}

function serviceOr503(res: http.ServerResponse, deps: BackgroundJobsRouteDeps): BackgroundJobsRouteDeps['service'] {
  if (!deps.service) {
    json(res, 503, { error: 'background job service not available' });
    return null;
  }
  return deps.service;
}

/** cursor 缺省/空/非法一律 undefined（`Number(null) === 0` 会把缺省当第一字节）。 */
export function parseBackgroundCursor(search: URLSearchParams): number | undefined {
  const raw = search.get('cursor');
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function sessionOf(search: URLSearchParams): string | undefined {
  const raw = search.get('sessionID');
  return raw && raw.trim() ? raw : undefined;
}

/** GET /api/background/jobs?sessionID= */
export async function handleBackgroundJobsList(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: BackgroundJobsRouteDeps,
): Promise<boolean> {
  if (req.method !== 'GET' || !/^\/api\/background\/jobs(?:\?|$)/.test(url)) return false;
  const service = serviceOr503(res, deps);
  if (!service) return true;
  const sessionID = sessionOf(searchOf(url));
  if (!sessionID) {
    json(res, 400, { error: 'sessionID is required' });
    return true;
  }
  try {
    json(res, 200, { items: await service.list(sessionID) });
  } catch (err) {
    fail(res, err);
  }
  return true;
}

const OUTPUT_RE = /^\/api\/background\/jobs\/([^/?]+)\/output(?:\?|$)/;
const CANCEL_RE = /^\/api\/background\/jobs\/([^/?]+)\/cancel(?:\?|$)/;

/** GET /api/background/jobs/:id/output?sessionID=&cursor= */
export async function handleBackgroundJobOutput(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: BackgroundJobsRouteDeps,
): Promise<boolean> {
  const match = url.match(OUTPUT_RE);
  if (!match || req.method !== 'GET') return false;
  const service = serviceOr503(res, deps);
  if (!service) return true;
  const search = searchOf(url);
  const sessionID = sessionOf(search);
  if (!sessionID) {
    json(res, 400, { error: 'sessionID is required' });
    return true;
  }
  try {
    const id = decodeURIComponent(match[1]);
    json(res, 200, await service.output(sessionID, id, parseBackgroundCursor(search)));
  } catch (err) {
    fail(res, err);
  }
  return true;
}

/** POST /api/background/jobs/:id/cancel?sessionID= */
export async function handleBackgroundJobCancel(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: BackgroundJobsRouteDeps,
): Promise<boolean> {
  const match = url.match(CANCEL_RE);
  if (!match || req.method !== 'POST') return false;
  const service = serviceOr503(res, deps);
  if (!service) return true;
  const sessionID = sessionOf(searchOf(url));
  if (!sessionID) {
    json(res, 400, { error: 'sessionID is required' });
    return true;
  }
  try {
    const id = decodeURIComponent(match[1]);
    json(res, 200, await service.cancel(sessionID, id));
  } catch (err) {
    fail(res, err);
  }
  return true;
}
