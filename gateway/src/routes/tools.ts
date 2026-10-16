// MAFW 基础工具 HTTP 面（deps 注入可单测）：
//   GET  /api/tools         —— 六件套 spec 清单（out-of-process runtime 的注册面）
//   POST /api/tools/execute —— 通用执行（name+params+sessionID；复用 buildMafwToolFactory）
// 信任域与 /api/python/* 一致（挂载点 isLoopback 门）。
import * as http from 'http';
import { MAFW_TOOL_SPECS } from '../runtime/mafw-tools';
import type { MafwToolRegistration } from '../runtime/contract';

export interface ToolsExecuteDeps {
  buildFactory: () => (sessionId: string) => MafwToolRegistration[];
}

export function handleToolsList(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ tools: MAFW_TOOL_SPECS }));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleToolsExecute(req: http.IncomingMessage, res: http.ServerResponse, deps: ToolsExecuteDeps): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `invalid JSON: ${err.message}` }));
    return;
  }
  const name = typeof body?.name === 'string' ? body.name : '';
  const sessionID = typeof body?.sessionID === 'string' ? body.sessionID : '';
  if (!name) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'name is required' }));
    return;
  }
  const registrations = deps.buildFactory()(sessionID);
  const reg = registrations.find((r) => r.name === name);
  if (!reg) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `unknown tool '${name}'`, available: registrations.map((r) => r.name) }));
    return;
  }
  try {
    const out = await reg.execute(body.params ?? {}, undefined);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  } catch (err: any) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err?.message || String(err) }));
  }
}
