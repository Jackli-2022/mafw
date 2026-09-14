import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';

export interface SessionBranchDeps {
  getRuntime(): AgentRuntime | null;
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
 * 分支原语薄代理（spec 2026-09-14 §1）。能力门：runtime 未声明
 * sessionBranchApi → 503；unrevert 是 opencode-only（pi 方法缺席）→ 404。
 * 返回 handled=false 表示路径不匹配，交给后续路由。
 */
export async function handleSessionBranch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionBranchDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/sessions\/([^/]+)\/(fork|revert|unrevert)(?:\?|$)/);
  if (!m || req.method !== 'POST') return false;
  const [, sessionID, action] = m;

  const rt = deps.getRuntime();
  if (!rt?.capabilities?.sessionBranchApi) {
    json(res, 503, { error: `capability 'sessionBranchApi' not available on runtime '${rt?.name ?? 'none'}'` });
    return true;
  }
  const body = await readBody(req);
  try {
    if (action === 'fork') {
      const session = await rt.session.fork!({ sessionID, messageID: body?.messageID });
      json(res, 200, { session });
    } else if (action === 'revert') {
      if (typeof body?.messageID !== 'string' || !body.messageID) {
        json(res, 400, { error: 'messageID required' });
        return true;
      }
      await rt.session.revert!({ sessionID, messageID: body.messageID, partID: body?.partID });
      json(res, 200, {});
    } else {
      if (typeof rt.session.unrevert !== 'function') {
        json(res, 404, { error: `runtime '${rt.name}' does not implement unrevert` });
        return true;
      }
      await rt.session.unrevert({ sessionID });
      json(res, 200, {});
    }
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
