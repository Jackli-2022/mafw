// per-session 审批模式 HTTP 面（deps 注入可单测）。注册顺序：必须在
// /api/permissions/:id 通配匹配之前（triage 吞噬教训）。

import * as http from 'http';
import { SessionPermissionMode, normalizeMode } from '../core/approval/policy-service';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface PermissionModeDeps {
  policy: {
    getMode(sessionID: string): Promise<SessionPermissionMode>;
    setMode(sessionID: string, mode: SessionPermissionMode): Promise<void>;
    getAutoApprovals(sessionID: string): number;
  };
  budget: number;
}

export async function handlePermissionModeGet(
  res: http.ServerResponse,
  sessionID: string,
  deps: PermissionModeDeps,
): Promise<void> {
  try {
    const mode = await deps.policy.getMode(sessionID);
    json(res, 200, { mode, autoApprovals: deps.policy.getAutoApprovals(sessionID), budget: deps.budget });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handlePermissionModeSet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  deps: PermissionModeDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (err: any) {
    json(res, 400, { error: `invalid JSON: ${err.message}` });
    return;
  }
  if (body?.mode !== 'read-only' && body?.mode !== 'auto' && body?.mode !== 'full-access' && body?.mode !== 'manual') {
    json(res, 400, { error: "mode must be 'read-only'|'auto'|'full-access' ('manual' accepted as legacy alias)" });
    return;
  }
  const mode: SessionPermissionMode = normalizeMode(body.mode);
  try {
    await deps.policy.setMode(sessionID, mode);
    json(res, 200, { mode, autoApprovals: 0, budget: deps.budget });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
