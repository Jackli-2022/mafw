/**
 * T2-3 data part 注入路由：POST /api/sessions/:id/data。
 * 校验/承载/持久化由 DataPartService 承担；本层只做信封与错误映射。
 */
import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';
import { DataPartError, type DataPartService } from '../core/data-parts/data-part-service';

export interface SessionDataDeps {
  getRuntime(): AgentRuntime | null;
  data?: DataPartService | null;
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c: any) => (body += c));
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleSessionData(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionDataDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/sessions\/([^/]+)\/data(?:\?|$)/);
  if (!m || req.method !== 'POST') return false;

  const service = deps.data;
  if (!service) {
    json(res, 503, { error: 'data part service unavailable' });
    return true;
  }

  try {
    const body = await readBody(req);
    const part = await service.create({
      sessionID: m[1],
      name: body?.name,
      id: body?.id,
      data: body?.data,
      transient: body?.transient === true,
      messageID: body?.messageID,
    });
    json(res, 200, { part });
  } catch (err: any) {
    if (err instanceof DataPartError) json(res, err.status, { error: err.message });
    else json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
