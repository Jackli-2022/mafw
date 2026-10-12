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
import { ToolPartAssembler, TOOL_PRIMITIVE_TYPES } from '../runtime/tool-part-assembler';

export interface DryEventDeps {
  /** 按 runtime 名取事件映射声明（loader meta）。 */
  getPluginEventEntry?: (name: string) => EventMappingEntry | null;
  /** 已知 runtime 名（400 响应列出）。 */
  listPlugins?: () => string[];
  /** 插件是否已注册（区分「已注册但无映射声明」与「未知插件」；缺省回退 listPlugins 包含性判断）。 */
  hasPlugin?: (name: string) => boolean;
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
      // 区分「已注册但无映射声明」（如 builtin opencode——恒等直通无表可试）
      // 与「未知插件」：前者不是拼写错误，错误信息不能误导（opencode 明明在
      // listPlugins 里，报 unknown 会让插件作者怀疑人生）。
      const exists = deps.hasPlugin
        ? deps.hasPlugin(body.plugin)
        : (deps.listPlugins?.() ?? []).includes(body.plugin);
      if (exists) {
        send(400, { error: `plugin '${body.plugin}' is registered but declares no event mappings — nothing to dry-run (identity-passthrough runtime)` });
        return;
      }
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

  // 工具三原语：走 assembler 跳，回显合成后的 ToolPart 快照（不进 facet/矩阵）。
  const mappedType: string = mapped?.payload?.type ?? mapped?.type ?? '';
  if (TOOL_PRIMITIVE_TYPES.has(mappedType)) {
    const assembler = new ToolPartAssembler();
    const props = mapped.payload?.properties ?? {};
    const p = { ...props, sessionID: props.sessionID ?? mapped.sessionID ?? 'dry' };
    const assembled =
      mappedType === 'tool.call' ? assembler.applyCall(p)
        : mappedType === 'tool.delta' ? assembler.applyDelta(p)
          : assembler.applyResult(p);
    send(200, {
      ...(body?.plugin ? { plugin: body.plugin, mapping } : {}),
      type: mappedType,
      known: true,
      facets: null,
      warnings: [],
      assembled,
    });
    return;
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
      compaction: f.compaction,
      toolCommand: f.toolCommand ?? null,
      approval: f.approval ?? null,
    },
    flow: row ? { modeA: row.modeA, desktop: row.desktop, tui: row.tui, note: row.note } : undefined,
    warnings: checkEventFields(mapped),
  });
}
