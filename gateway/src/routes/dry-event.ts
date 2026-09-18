/**
 * POST /api/runtime/dry-event —— 事件试衣间（插件作者离线验证）。
 *
 * 输入一个 runtime 原生事件样本（形状 A/B 均可，直接对象或 {event} 信封），
 * 返回它将被如何消费：normalize facets + 矩阵每跳处置 + 字段契约警告。
 * 纯函数组装，零 deps，无副作用（不广播、不落库）。
 */
import * as http from 'http';
import { normalizeOpencodeEvent } from '../runtime/normalize';
import { EVENT_FLOW_MATRIX } from '../runtime/event-flow-matrix';
import { isKnownEventType } from '../runtime/event-telemetry';
import { checkEventFields } from '../runtime/event-field-contract';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleDryEvent(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    send(400, { error: `invalid JSON body: ${err.message}` });
    return;
  }
  // 宽容输入：{event: {...}} 信封 或 直接对象
  const evt = body && typeof body === 'object' && body.event && typeof body.event === 'object'
    ? body.event
    : body;
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) {
    send(400, { error: 'body must be { event: {...} } or an event object' });
    return;
  }

  const type: string = evt?.payload?.type || evt?.type || '';
  const known = isKnownEventType(type);
  const f = normalizeOpencodeEvent(evt);
  const row = known ? EVENT_FLOW_MATRIX[type] : undefined;
  send(200, {
    type,
    known,
    facets: {
      sessionID: f.sessionID ?? null,
      step: !!f.step,
      chatSignal: f.chatSignal,
      broadcast: f.broadcast,
      compaction: f.compaction,
      toolCommand: f.toolCommand ?? null,
    },
    flow: row ? { modeA: row.modeA, desktop: row.desktop, tui: row.tui, note: row.note } : undefined,
    warnings: checkEventFields(evt),
  });
}
