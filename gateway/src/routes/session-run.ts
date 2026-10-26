/**
 * T2-2 回合软暂停路由（能力门 runStateApi）：
 *   POST /api/sessions/:id/suspend       忙时暂停 → {run}
 *   POST /api/sessions/:id/resume        恢复（settled + idle）→ {run, prompted:true}
 *   GET  /api/sessions/:id/run          活跃 run → {run|null}
 *   POST /api/sessions/:id/run/discard  放弃 → {run}
 *
 * 返回 handled=false 交给后续路由（对齐 session-checkpoints 约定）。
 */
import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';
import { RunStateError } from '../core/run/run-state-service';
import type { RunCoordinator } from '../core/run/run-coordinator';

export interface SessionRunDeps {
  getRuntime(): AgentRuntime | null;
  run?: RunCoordinator | null;
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

export async function handleSessionRun(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionRunDeps,
): Promise<boolean> {
  const discard = url.match(/^\/api\/sessions\/([^/]+)\/run\/discard(?:\?|$)/);
  const active = discard ? null : url.match(/^\/api\/sessions\/([^/]+)\/run(?:\?|$)/);
  const suspend = discard || active ? null : url.match(/^\/api\/sessions\/([^/]+)\/suspend(?:\?|$)/);
  const resume = discard || active || suspend ? null : url.match(/^\/api\/sessions\/([^/]+)\/resume(?:\?|$)/);
  if (!discard && !active && !suspend && !resume) return false;

  if (discard && req.method !== 'POST') return false;
  if (active && req.method !== 'GET') return false;
  if (suspend && req.method !== 'POST') return false;
  if (resume && req.method !== 'POST') return false;

  const rt = deps.getRuntime();
  const run = deps.run;
  if (!rt?.capabilities?.runStateApi || !run) {
    json(res, 503, {
      error: `capability 'runStateApi' not available on runtime '${rt?.name ?? 'none'}'`,
    });
    return true;
  }

  try {
    if (suspend) {
      const body = await readBody(req);
      const reason = typeof body?.reason === 'string' && body.reason ? body.reason : undefined;
      json(res, 200, { run: await run.suspend(suspend[1], reason) });
      return true;
    }
    if (resume) {
      const body = await readBody(req);
      const runId = typeof body?.runId === 'string' && body.runId ? body.runId : undefined;
      json(res, 200, await run.resume(resume[1], runId));
      return true;
    }
    if (discard) {
      const body = await readBody(req);
      const runId = typeof body?.runId === 'string' && body.runId ? body.runId : undefined;
      json(res, 200, { run: await run.discard(discard[1], runId) });
      return true;
    }
    json(res, 200, { run: run.active(active![1]) });
  } catch (err: any) {
    if (err instanceof RunStateError) {
      json(res, err.status, { error: err.message });
    } else {
      json(res, 500, { error: err?.message ?? String(err) });
    }
  }
  return true;
}
