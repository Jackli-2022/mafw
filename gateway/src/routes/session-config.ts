import * as http from 'http';
import type { SessionConfigService } from '../core/session-config';

export interface SessionConfigRouteDeps {
  service: SessionConfigService | null | undefined;
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
  try {
    json(res, 200, await service.set(sessionID, body.category, body.value));
  } catch (err: any) {
    json(res, typeof err?.status === 'number' ? err.status : 500, { error: err?.message ?? String(err) });
  }
}
