/**
 * T2-1 session checkpoint 路由（能力门 checkpointApi）：
 *   POST /api/sessions/:id/checkpoint                   手动创建
 *   GET  /api/sessions/:id/checkpoints                  列表
 *   POST /api/sessions/:id/checkpoints/:cid/restore     三态 restore（confirm:true）
 *
 * 返回 handled=false 表示路径不匹配，交给后续路由（对齐 session-branch 约定）。
 */
import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';
import {
  CheckpointRestoreError,
  type CheckpointScope,
  type CheckpointService,
} from '../core/checkpoint/checkpoint-service';

export interface SessionCheckpointDeps {
  getRuntime(): AgentRuntime | null;
  checkpoints?: CheckpointService;
  /** 回合进行中禁止 restore/create（gateway-side files apply 没有 serve 的 busy 保护）。 */
  isBusy?(sessionID: string): boolean;
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

const SCOPES: readonly CheckpointScope[] = ['session', 'files', 'both'];

export async function handleSessionCheckpoints(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionCheckpointDeps,
): Promise<boolean> {
  const restore = url.match(/^\/api\/sessions\/([^/]+)\/checkpoints\/([^/]+)\/restore(?:\?|$)/);
  const list = restore ? null : url.match(/^\/api\/sessions\/([^/]+)\/checkpoints(?:\?|$)/);
  const create = restore || list ? null : url.match(/^\/api\/sessions\/([^/]+)\/checkpoint(?:\?|$)/);
  if (!restore && !list && !create) return false;

  if (restore && req.method !== 'POST') return false;
  if (list && req.method !== 'GET') return false;
  if (create && req.method !== 'POST') return false;

  const rt = deps.getRuntime();
  if (!rt?.capabilities?.checkpointApi) {
    json(res, 503, {
      error: `capability 'checkpointApi' not available on runtime '${rt?.name ?? 'none'}'`,
    });
    return true;
  }
  const svc = deps.checkpoints;
  if (!svc) {
    json(res, 503, { error: 'checkpoint service unavailable' });
    return true;
  }

  const sessionID = restore?.[1] ?? list?.[1] ?? (create as RegExpMatchArray)[1];
  if (deps.isBusy?.(sessionID)) {
    json(res, 409, { error: 'session is busy; retry after the current turn completes' });
    return true;
  }

  try {
    if (restore) {
      const [, sessionID, checkpointId] = restore;
      const body = await readBody(req);
      const scope = body?.scope;
      if (!SCOPES.includes(scope)) {
        json(res, 400, { error: 'scope must be one of session|files|both' });
        return true;
      }
      if (body?.confirm !== true) {
        json(res, 400, { error: 'confirm:true required' });
        return true;
      }
      const result = await svc.restore({ sessionID, checkpointId, scope });
      json(res, 200, result);
      return true;
    }

    if (list) {
      json(res, 200, { checkpoints: svc.list(list[1]) });
      return true;
    }

    const body = await readBody(req);
    const messageID = typeof body?.messageID === 'string' && body.messageID
      ? body.messageID
      : undefined;
    const checkpoint = await svc.createManual({
      sessionID: create![1],
      messageID,
    });
    json(res, 200, { checkpoint });
  } catch (err: any) {
    if (err instanceof CheckpointRestoreError) {
      json(res, err.status, { error: err.message });
    } else {
      json(res, 500, { error: err?.message ?? String(err) });
    }
  }
  return true;
}

