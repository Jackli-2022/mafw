// 持久规则 CRUD（Config 页规则管理 / 切片 1）。deps 注入可单测。
// 与 allowlist.ts 形态一致；action 固定 'allow'（deny 规则留待后续需要）。

import * as http from 'http';
import { PermissionRule, PermissionRulesStore } from '../core/approval/rules-store';

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

export interface RulesRouteDeps {
  store: Pick<PermissionRulesStore, 'list' | 'add' | 'remove'>;
}

function parseRuleBody(body: any): PermissionRule | null {
  const tool = typeof body?.tool === 'string' ? body.tool.trim() : '';
  if (!tool) return null;
  const pattern = typeof body?.pattern === 'string' ? body.pattern.trim().replace(/\*+$/, '').trim() : '';
  return pattern ? { tool, pattern, action: 'allow' } : { tool, action: 'allow' };
}

export async function handleRulesGet(res: http.ServerResponse, deps: RulesRouteDeps): Promise<void> {
  json(res, 200, { entries: deps.store.list() });
}

export async function handleRulesPost(req: http.IncomingMessage, res: http.ServerResponse, deps: RulesRouteDeps): Promise<void> {
  let rule: PermissionRule | null = null;
  try {
    rule = parseRuleBody(JSON.parse(await readBody(req) || '{}'));
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return;
  }
  if (!rule) { json(res, 400, { error: 'tool is required (non-empty string); pattern optional' }); return; }
  try {
    const result = deps.store.add(rule);
    json(res, 200, { success: result.ok, entries: result.rules });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleRulesDelete(req: http.IncomingMessage, res: http.ServerResponse, deps: RulesRouteDeps): Promise<void> {
  let rule: PermissionRule | null = null;
  try {
    rule = parseRuleBody(JSON.parse(await readBody(req) || '{}'));
  } catch {
    json(res, 400, { error: 'invalid JSON' });
    return;
  }
  if (!rule) { json(res, 400, { error: 'tool is required' }); return; }
  try {
    const result = deps.store.remove(rule);
    if (!result.ok) { json(res, 404, { error: 'rule not found' }); return; }
    json(res, 200, { success: true, entries: result.rules });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}
