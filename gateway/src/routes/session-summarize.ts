import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';
import { RuntimeAccess, surfaceUnavailableMessage } from '../runtime/runtime-access';

export interface SessionSummarizeDeps {
  getRuntime(): AgentRuntime | null;
  /** surface 门（缺省由 runtime 现场构造 RuntimeAccess）。 */
  getAccess?(): RuntimeAccess | null;
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

/**
 * POST /api/session/:id/summarize — 手动压缩会话（TUI /compact）。
 * 薄代理到 runtime.session.summarize（opencode 原生 compaction；pi 同步实现）。
 * 返回 handled=false 表示路径不匹配，交给后续路由。
 */
export async function handleSessionSummarize(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionSummarizeDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/session\/([^/]+)\/summarize(?:\?|$)/);
  if (!m || req.method !== 'POST') return false;
  const sessionID = m[1];

  const rt = deps.getRuntime();
  const access = deps.getAccess?.() ?? (rt ? new RuntimeAccess(rt) : null);
  if (!rt || !access?.can('session.summarize')) {
    json(res, 503, { error: surfaceUnavailableMessage('session.summarize') });
    return true;
  }
  try {
    const body = await readBody(req);
    await rt.session.summarize({
      sessionID,
      ...(typeof body?.providerID === 'string' ? { providerID: body.providerID } : {}),
      ...(typeof body?.modelID === 'string' ? { modelID: body.modelID } : {}),
    });
    json(res, 200, {});
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
