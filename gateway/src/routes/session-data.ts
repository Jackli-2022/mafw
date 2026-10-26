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

const MAX_BODY_BYTES = 256 * 1024;

/** Buffer 分块拼接（避免逐块 toString 切断多字节 UTF-8）+ 硬体积帽。 */
function readBody(req: http.IncomingMessage): Promise<{ raw: string; tooLarge: boolean }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (c: any) => {
      if (tooLarge) return;
      const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
      size += b.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(b);
    });
    req.on('end', () => resolve({ raw: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', () => resolve({ raw: '', tooLarge: false }));
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
    const { raw, tooLarge } = await readBody(req);
    if (tooLarge) {
      json(res, 413, { error: 'request body too large' });
      return true;
    }
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
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
