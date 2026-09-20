import * as http from 'http';
import { AgentRuntime } from '../runtime/contract';
import { deriveAlwaysRule } from '../core/approval/rules-store';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** 'always' 回复沉淀持久规则的反查依赖（findRequest 反查审批请求以取 tool/patterns）。 */
export interface PersistAlwaysDeps {
  rules: { add(rule: { tool: string; pattern?: string; action: 'allow' }): { ok: boolean } };
  findRequest(): Promise<{ permission?: string; toolName?: string; patterns?: string[] } | null>;
}

export async function handlePermissionReply(
  runtime: AgentRuntime | null,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  requestId: string,
  persistDeps?: PersistAlwaysDeps,
): Promise<void> {
  if (!runtime?.session?.permissionReply) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Runtime does not support permissionReply' }));
    return;
  }

  try {
    const body = JSON.parse(await readBody(req) || '{}');
    let reply: 'once' | 'always' | 'reject' | undefined = body.reply;
    let message: string | undefined = body.message;
    if (typeof body.approved === 'boolean' && !reply) {
      reply = body.approved ? 'once' : 'reject'; // legacy bool callers
    }
    if (reply !== 'once' && reply !== 'always' && reply !== 'reject') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "reply must be 'once'|'always'|'reject'" }));
      return;
    }
    const result = await runtime.session.permissionReply!(sessionID, requestId, reply, message);

    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Permission request not found' }));
      return;
    }

    // 切片 1：'always' 回复自动沉淀持久规则（无需客户端 persist:true；scope 见下；
    // fail-open：反查失败只 warn，不阻断已成功的回复）。
    if (reply === 'always' && persistDeps) {
      try {
        const found = await persistDeps.findRequest();
        const scope = body.persist === 'tool' ? 'tool' : body.persist === 'prefix' ? 'prefix' : true;
        const rule = deriveAlwaysRule(found ?? {}, scope);
        if (rule) persistDeps.rules.add(rule);
      } catch (err: any) {
        console.warn('[Permission] persist always rule failed (non-fatal):', err?.message);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

