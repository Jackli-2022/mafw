import * as http from 'http';
import type { SessionConfigService } from '../core/session-config';

export interface SessionConfigRouteDeps {
  service: SessionConfigService | null | undefined;
  /** agent 类别的 coordinator 门（与 session.switchAgent 共用同一校验）；返回错误或 null。 */
  checkAgentSwitch?: (sessionID: string, agent: string) => { status: number; error: string } | null;
}

function json(res: http.ServerResponse, status: number, body: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function serviceOr503(res: http.ServerResponse, deps: SessionConfigRouteDeps): SessionConfigService | null {
  if (!deps.service) { json(res, 503, { error: 'session config service not available' }); return null; }
  return deps.service;
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

export async function handleSessionConfigGet(
  res: http.ServerResponse,
  sessionID: string,
  deps: SessionConfigRouteDeps,
): Promise<void> {
  const service = serviceOr503(res, deps);
  if (!service) return;
  try { json(res, 200, await service.get(sessionID)); }
  catch (err: any) { json(res, typeof err?.status === 'number' ? err.status : 500, { error: err?.message ?? String(err) }); }
}

export async function handleSessionConfigSet(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  deps: SessionConfigRouteDeps,
): Promise<void> {
  const service = serviceOr503(res, deps);
  if (!service) return;
  let body: any;
  try { body = await readJson(req); } catch { json(res, 400, { error: 'invalid json' }); return; }
  if (typeof body?.category !== 'string') { json(res, 400, { error: 'category is required' }); return; }
  // agent 类别与裸 switchAgent 路由共用 coordinator 门（防经 façade 绕过）。
  if (body.category === 'agent' && typeof body.value === 'string' && deps.checkAgentSwitch) {
    const denied = deps.checkAgentSwitch(sessionID, body.value);
    if (denied) { json(res, denied.status, { error: denied.error }); return; }
  }
  try {
    json(res, 200, await service.set(sessionID, body.category, body.value));
  } catch (err: any) {
    json(res, typeof err?.status === 'number' ? err.status : 500, { error: err?.message ?? String(err) });
  }
}
