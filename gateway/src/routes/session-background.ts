import * as http from 'http';
import type { AgentRuntime } from '../runtime/contract';
import type { RuntimeAccess } from '../runtime/runtime-access';

export interface SessionBackgroundDeps {
  getRuntime(): AgentRuntime | null;
  getAccess(): RuntimeAccess | null;
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleSessionBackground(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SessionBackgroundDeps,
): Promise<boolean> {
  const match = url.match(/^\/api\/session\/([^/]+)\/background(?:\?|$)/);
  if (!match || req.method !== 'POST') return false;
  const rt = deps.getRuntime();
  const access = deps.getAccess();
  if (!rt || !access?.can('session.background') || typeof rt.session.background !== 'function') {
    json(res, 503, { error: "runtime surface 'session.background' is not available" });
    return true;
  }
  try {
    await rt.session.background({ sessionID: match[1] });
    json(res, 200, {});
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
