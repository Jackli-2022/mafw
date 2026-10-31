/**
 * File history routes (2026-10-31) — 文件级历史快照的显式入口。
 *
 * - POST /api/file-history/snapshot  { sessionID, directory, paths[], reason? }
 * - GET  /api/file-history?sessionID=&rel=      → 条目列表（最新在前）
 * - POST /api/file-history/restore   { sessionID, entryId } → 恢复并返回 rel
 *
 * 自动快照由 gateway 在写类工具 running 时触发；本路由给 office-editing 技能
 * （保存前显式快照）与桌面/调试使用。全部 loopback-only。
 */
import * as http from 'http';
import type { FileHistoryService } from '../core/file-history/file-history-service';

export type FileHistoryRouteDeps = {
  service: () => FileHistoryService | null;
  isLoopback: boolean;
  /** directory 缺省时按 sessionID 解析（office 技能只传 sessionID）。 */
  resolveDirectory?: (sessionID: string) => Promise<string | null>;
};

const MAX_BODY = 1_048_576;
const MAX_PATHS = 200;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** 返回 true = 已消费该请求。 */
export async function handleFileHistoryRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: FileHistoryRouteDeps,
): Promise<boolean> {
  const url = req.url ?? '';
  const isSnapshot = url === '/api/file-history/snapshot' && req.method === 'POST';
  const isRestore = url === '/api/file-history/restore' && req.method === 'POST';
  const isList = /^\/api\/file-history(?:\?|$)/.test(url) && req.method === 'GET';
  if (!isSnapshot && !isRestore && !isList) return false;
  if (!deps.isLoopback) { send(res, 403, { error: 'forbidden' }); return true; }
  const service = deps.service();
  if (!service) { send(res, 503, { error: 'file history unavailable' }); return true; }

  if (isList) {
    const q = new URL(url, 'http://localhost').searchParams;
    const sessionID = q.get('sessionID') ?? '';
    if (!sessionID) { send(res, 400, { error: 'sessionID is required' }); return true; }
    const rel = q.get('rel') ?? undefined;
    try {
      const entries = await service.list(sessionID, rel);
      send(res, 200, { entries });
    } catch (err: any) {
      send(res, 500, { error: String(err?.message ?? err).slice(0, 200) });
    }
    return true;
  }

  let body: any;
  try { body = JSON.parse(await readBody(req)); } catch { send(res, 400, { error: 'invalid JSON body' }); return true; }

  if (isSnapshot) {
    const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
    const directory = typeof body?.directory === 'string' && body.directory
      ? body.directory
      : (sessionID && deps.resolveDirectory ? (await deps.resolveDirectory(sessionID)) ?? '' : '');
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: any) => typeof p === 'string') : [];
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : undefined;
    if (!sessionID || !directory || paths.length === 0 || paths.length > MAX_PATHS) {
      send(res, 400, { error: 'sessionID, directory (or resolvable session), and paths[1..200] are required' });
      return true;
    }
    try {
      const result = await service.snapshot({ sessionID, projectDir: directory, relPaths: paths, reason });
      send(res, 200, result);
    } catch (err: any) {
      send(res, 500, { error: String(err?.message ?? err).slice(0, 200) });
    }
    return true;
  }

  // restore
  const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
  const entryId = typeof body?.entryId === 'string' ? body.entryId : '';
  if (!sessionID || !entryId) { send(res, 400, { error: 'sessionID and entryId are required' }); return true; }
  try {
    const result = await service.restore(sessionID, entryId);
    if (result.ok) { send(res, 200, result); return true; }
    const status = result.reason === 'not-found' || result.reason === 'blob-missing' ? 404 : 409;
    send(res, status, result);
  } catch (err: any) {
    send(res, 500, { error: String(err?.message ?? err).slice(0, 200) });
  }
  return true;
}
