// 持久白名单 CRUD（Config 页编辑器 / TUI 持久允许共用）。deps 注入可单测。

import * as http from 'http';
import { AllowlistEntry, AllowlistStore } from '../core/approval/allowlist-store';

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

export interface AllowlistRouteDeps {
  store: Pick<AllowlistStore, 'list' | 'add' | 'remove'>;
}

function parseEntryBody(body: any): AllowlistEntry | null {
  const tool = typeof body?.tool === 'string' ? body.tool.trim() : '';
  if (!tool) return null;
  const prefix = typeof body?.prefix === 'string' ? body.prefix.trim() : '';
  return prefix ? { tool, prefix } : { tool };
}

export async function handleAllowlistGet(res: http.ServerResponse, deps: AllowlistRouteDeps): Promise<void> {
  json(res, 200, { entries: deps.store.list() });
}

export async function handleAllowlistPost(req: http.IncomingMessage, res: http.ServerResponse, deps: AllowlistRouteDeps): Promise<void> {
  let entry: AllowlistEntry | null = null;
  try {
    entry = parseEntryBody(JSON.parse(await readBody(req) || '{}'));
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return;
  }
  if (!entry) { json(res, 400, { error: 'tool is required (non-empty string); prefix optional' }); return; }
  try {
    const result = await deps.store.add(entry);
    json(res, 200, { success: result.ok, entries: result.entries });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleAllowlistDelete(req: http.IncomingMessage, res: http.ServerResponse, deps: AllowlistRouteDeps): Promise<void> {
  let entry: AllowlistEntry | null = null;
  try {
    entry = parseEntryBody(JSON.parse(await readBody(req) || '{}'));
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return;
  }
  if (!entry) { json(res, 400, { error: 'tool is required' }); return; }
  try {
    const result = await deps.store.remove(entry);
    if (!result.ok) { json(res, 404, { error: 'allowlist entry not found' }); return; }
    json(res, 200, { success: true, entries: result.entries });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
