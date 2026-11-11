/**
 * POST /api/events —— 事件发布接口（deps 注入可单测）。
 *
 * 语义（业界调研 2026-09-16）：SSE 事件是通知语义（JSON-RPC 通知分支），
 * 消费方（desktop/TUI）对未知 type 静默忽略——发送方随时可加新类型，
 * 无类型注册制（对齐 SSE 原生分发 / Stripe webhook else 分支 / K8s BOOKMARK 先例）。
 *
 * **保留名守卫（E1-2）**：这个路由是**外部发布**通道，只接受自定义命名空间
 * （推荐 `plugin:<name>:<event>`）。gateway/runtime 自己的事件名（EVENT_FLOW_MATRIX
 * canonical/扁平事件、MAFW_FLAT_EVENT_NAMES、runtime 原生 `sync`、`mafw_event`
 * 信封）一律 400：否则外部进程可以伪造 `turn.completed` / `session.created` 写进
 * event_log 并被所有客户端回放。内部发布走 `EventHub.broadcast()`，不经此路由。
 *
 * 形态：顶层扁平 `{ type: 'plugin:<name>:<event>', ...payload }` → 原样广播
 * （与 runtime_switched / project_registered 同信封约定，桌面剥壳 raw?.data || raw）。
 */
import * as http from 'http';
import { EVENT_FLOW_MATRIX, RUNTIME_NATIVE_DROPPED } from '../runtime/event-flow-matrix';
import { MAFW_FLAT_EVENT_NAMES } from '../runtime/mafw-vocabulary';

/** 保留事件名（gateway / runtime 自有，外部发布一律拒绝）。 */
const RESERVED_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(EVENT_FLOW_MATRIX),
  ...MAFW_FLAT_EVENT_NAMES,
  ...RUNTIME_NATIVE_DROPPED,
]);

/** 保留命名空间（`mafw_event` 信封本身即伪造面）。 */
export function isReservedEventType(type: string): boolean {
  return type === 'mafw_event' || type.startsWith('mafw_event.') || RESERVED_EVENT_TYPES.has(type);
}

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
  /** 未知类型遥测（扁平非 plugin:* 命名空间时调用；fail-open）。 */
  recordUnknown?: (type: string) => void;
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
    if (isReservedEventType(body.type)) {
      // E1-2：保留名拒绝，先于任何广播/append/遥测。
      send(400, {
        error: `reserved event type: '${body.type}' (publish custom events as 'plugin:<name>:<event>')`,
      });
      return;
    }
    if (!body.type.startsWith('plugin:')) {
      // 未知类型遥测：扁平非命名空间发布计为潜在漏接线（fail-open）
      try { deps.recordUnknown?.(body.type); } catch { /* fail-open */ }
    }
    deps.broadcast(body);
    send(200, { ok: true });
  } catch (err: any) {
    send(400, { error: `invalid JSON body: ${err.message}` });
  }
}
