import * as http from 'http';
import { AgentRuntime } from '../runtime/contract';
import type { RuntimeAccess } from '../runtime/runtime-access';
import { surfaceUnavailableMessage } from '../runtime/runtime-access';
import { deriveAlwaysRule } from '../core/approval/rules-store';
import { appendApprovalRecord } from '../core/approval/decision-log';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** 'always' 回复沉淀持久规则的反查依赖（findRequest 反查审批请求以取 tool/patterns）。 */
export interface PersistAlwaysDeps {
  rules: { add(rule: { tool: string; pattern?: string; action: 'allow' }): { ok: boolean } };
  findRequest(): Promise<{ permission?: string; toolName?: string; patterns?: string[] } | null>;
}

export interface PermissionReplyDeps extends Partial<PersistAlwaysDeps> {
  /** surface 门（approval.permissionReply）。缺省视为不可用——路由必须显式注入。 */
  access?: RuntimeAccess | null;
}

function persistRule(body: any, deps: PermissionReplyDeps | undefined, found: any): void {
  if (!deps?.rules) return;
  try {
    const scope = body.persist === 'tool' ? 'tool' : body.persist === 'prefix' ? 'prefix' : true;
    const rule = deriveAlwaysRule(found ?? {}, scope);
    if (rule) deps.rules.add(rule);
  } catch (err: any) {
    console.warn('[Permission] persist always rule failed (non-fatal):', err?.message);
  }
}

/**
 * POST /api/sessions/:id/permissions/:requestId — 会话直连入口。
 * 能力门：approval.permissionReply surface。
 */
export async function handlePermissionReply(
  runtime: AgentRuntime | null,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  requestId: string,
  deps?: PermissionReplyDeps,
): Promise<void> {
  if (!runtime || !deps?.access?.can('approval.permissionReply')) {
    json(res, 503, { error: surfaceUnavailableMessage('approval.permissionReply') });
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
      json(res, 400, { error: "reply must be 'once'|'always'|'reject'" });
      return;
    }
    const result = await runtime.session.permissionReply!(sessionID, requestId, reply, message);

    if (!result) {
      json(res, 404, { error: 'Permission request not found' });
      return;
    }

    // P1.5: record the human's reply (joins the eval record by requestId).
    appendApprovalRecord({ e: 'reply', requestId, sessionID, reply, ts: Date.now() });

    // 切片 1：'always' 回复自动沉淀持久规则（无需客户端 persist:true；scope 见下；
    // fail-open：反查失败只 warn，不阻断已成功的回复）。
    if (reply === 'always' && deps?.findRequest) {
      let found: any = null;
      try {
        found = await deps.findRequest();
      } catch (err: any) {
        console.warn('[Permission] persist always rule failed (non-fatal):', err?.message);
      }
      persistRule(body, deps, found);
    }

    json(res, 200, { success: true });
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export interface PermissionReplyByIdDeps {
  runtime: AgentRuntime | null;
  access: RuntimeAccess | null;
  /** 'always' 持久规则库（缺省只回复不沉淀）。 */
  rules?: PersistAlwaysDeps['rules'];
  /** Test seam（缺省写 decision log）。 */
  appendRecord?: typeof appendApprovalRecord;
}

/**
 * POST /api/permissions/:id/reply — 按 requestId 的全局入口（列表反查 sessionID）。
 * 能力门：approval.permissionReply + approval.permissionList surface。
 */
export async function handlePermissionReplyById(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  requestId: string,
  deps: PermissionReplyByIdDeps,
): Promise<void> {
  const { runtime, access } = deps;
  if (!runtime || !access?.can('approval.permissionReply')) {
    json(res, 503, { status: 'error', error: surfaceUnavailableMessage('approval.permissionReply') });
    return;
  }
  if (!access.can('approval.permissionList')) {
    json(res, 503, { status: 'error', error: surfaceUnavailableMessage('approval.permissionList') });
    return;
  }
  try {
    const body = JSON.parse(await readBody(req) || '{}');
    const reply = body.reply;
    if (reply !== 'once' && reply !== 'always' && reply !== 'reject') {
      json(res, 400, { status: 'error', error: "reply must be 'once'|'always'|'reject'" });
      return;
    }
    // 反查 sessionID：pending 列表项携带（与 runtime 形状一致）
    const pending = await runtime.session.permissionList!();
    const found = (Array.isArray(pending) ? pending : []).find((p: any) => p?.id === requestId);
    if (!found?.sessionID) {
      json(res, 404, { status: 'error', error: 'permission request not found' });
      return;
    }
    const ok = await runtime.session.permissionReply!(found.sessionID, requestId, reply, body.message);
    if (!ok) {
      json(res, 404, { status: 'error', error: 'permission request not found' });
      return;
    }
    // P1.5: record the human's reply (joins the eval record by requestId).
    try {
      (deps.appendRecord ?? appendApprovalRecord)({
        e: 'reply', requestId, sessionID: found.sessionID, reply, ts: Date.now(),
      });
    } catch { /* fail-open */ }
    // always：回复成功后沉淀持久规则（spec 切片 1；scope 由 persist 参数控制；
    // 缺省 true = prefix 优先自动推导；fail-open 不阻塞回复）
    if (reply === 'always') persistRule(body, { rules: deps.rules }, found);
    json(res, 200, { status: 'ok' });
  } catch (err: any) {
    console.error('[Permission] reply error:', err?.message);
    json(res, 400, { status: 'error', error: err?.message ?? String(err) });
  }
}
