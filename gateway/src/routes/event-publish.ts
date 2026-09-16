/**
 * POST /api/events —— 事件发布接口（deps 注入可单测）。
 *
 * 语义（业界调研 2026-09-16）：SSE 事件是通知语义（JSON-RPC 通知分支），
 * 消费方（desktop/TUI）对未知 type 静默忽略——发送方随时可加新类型，
 * 无类型注册制（对齐 SSE 原生分发 / Stripe webhook else 分支 / K8s BOOKMARK 先例）。
 *
 * 双发布形态：
 * - 顶层扁平：{ type: 'plugin:<name>:<event>', ...payload } → 原样广播
 *   （与 runtime_switched / project_registered 同 wire 约定，桌面剥壳 raw?.data || raw）
 * - opencode_event 信封：{ type: 'opencode_event', data: { type, ... } } → data
 *   经 opencodeBroadcast 形状守卫（畸形 data.type 打诊断日志后照发）
 */
import * as http from 'http';
import { opencodeBroadcast } from '../runtime/event-broadcast';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => body += c);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export interface EventPublishDeps {
  /** gateway 全通道广播（SSE + WS + 移动端推送） */
  broadcast: (event: { type: string; [key: string]: any }) => void;
}

export async function handleEventPublish(
  deps: EventPublishDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  try {
    const body = JSON.parse(await readBody(req));
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      send(400, { error: 'body must be a JSON object' });
      return;
    }
    if (typeof body.type !== 'string' || !body.type) {
      send(400, { error: "body.type must be a non-empty string (recommended namespace: 'plugin:<name>:<event>')" });
      return;
    }
    if (body.type === 'opencode_event') {
      // 信封旁路：data 形状守卫（data.type 缺失 → 400，不发半成品事件）
      if (!body.data || typeof body.data !== 'object' || typeof body.data.type !== 'string' || !body.data.type) {
        send(400, { error: 'opencode_event envelope requires data.type (non-empty string)' });
        return;
      }
      deps.broadcast(opencodeBroadcast(body.data, body.data.internal === true) as any);
      send(200, { ok: true });
      return;
    }
    deps.broadcast(body);
    send(200, { ok: true });
  } catch (err: any) {
    send(400, { error: `invalid JSON body: ${err.message}` });
  }
}
