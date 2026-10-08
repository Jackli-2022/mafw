/**
 * POST /api/runtime/dry-event —— 事件试衣间（插件作者离线验证）。
 *
 * 输入一个 runtime 原生事件样本（形状 A/B 均可，直接对象或 {event} 信封）。
 * 可选 { plugin }：先经该 runtime 的事件映射表（原生 → canonical），再走
 * normalize facets + 矩阵每跳处置 + 字段契约警告。纯函数组装，无副作用。
 */
import * as http from 'http';
import { normalizeOpencodeEvent } from '../runtime/normalize';
import { EVENT_FLOW_MATRIX } from '../runtime/event-flow-matrix';
import { isKnownEventType } from '../runtime/event-telemetry';
import { checkEventFields } from '../runtime/event-field-contract';
import { applyEventMappings, EventMappingEntry } from '../runtime/event-mapper';

export interface DryEventDeps {
  /** 按 runtime 名取事件映射声明（loader meta）。 */
  getPluginEventEntry?: (name: string) => EventMappingEntry | null;
  /** 已知 runtime 名（400 响应列出）。 */
  listPlugins?: () => string[];
  /** canonical 词汇表判定（缺省 isKnownEventType）。 */
  isCanonicalType?: (t: string) => boolean;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleDryEvent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: DryEventDeps = {},
): Promise<void> {
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

  // 可选映射跳：{ plugin: 'pi', event: <原生事件> } → 先过该 runtime 的映射表
  let mapped = evt;
  let mapping: { matched: boolean; to?: string; dropped?: boolean } | undefined;
  if (typeof body?.plugin === 'string' && body.plugin) {
    const entry = deps.getPluginEventEntry?.(body.plugin) ?? null;
    if (!entry) {
      send(400, { error: `unknown plugin '${body.plugin}'`, available: deps.listPlugins?.() ?? [] });
      return;
    }
    const isCanonical = deps.isCanonicalType ?? ((t: string) => isKnownEventType(t));
    const out = applyEventMappings(evt, entry, isCanonical);
    if (out.length === 0) {
      send(200, { plugin: body.plugin, mapping: { matched: false, dropped: true }, type: null, known: false, facets: null, warnings: [] });
      return;
    }
    mapped = out[0];
    mapping = { matched: true, to: mapped?.payload?.type ?? mapped?.type };
  }

  const type: string = mapped?.payload?.type || mapped?.type || '';
  const known = isKnownEventType(type);
  const f = normalizeOpencodeEvent(mapped);
  const row = known ? EVENT_FLOW_MATRIX[type] : undefined;
  send(200, {
    ...(body?.plugin ? { plugin: body.plugin, mapping } : {}),
    type,
    known,
    facets: {
      sessionID: f.sessionID ?? null,
      step: !!f.step,
      chatSignal: f.chatSignal,
      broadcast: f.broadcast,
      compaction: f.compaction,
      toolCommand: f.toolCommand ?? null,
      approval: f.approval ?? null,
    },
    flow: row ? { modeA: row.modeA, desktop: row.desktop, tui: row.tui, note: row.note } : undefined,
    warnings: checkEventFields(mapped),
  });
}
