/**
 * wire-compat —— egress 出口转换：canonical flat（MafwMessage）→ v1 wire（{info, parts[]}）。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.4
 * 本模块是 gateway **唯一**的 flat→wire 转换点，只挂在两处出口：
 *   ① SSE 广播出口（message.updated 载荷，Plan 2 接线）
 *   ② 历史 serving 出口（/api/sessions/:id/messages，Plan 1 Task 4 接线）
 *
 * 不变量：
 *  - **零换名**（ledger Task 4 修正裁决）：flat ↔ wire 是纯信封搬移——info
 *    字段全量同名透传（含 UserMessage.model 对象 / AssistantMessage.modelID
 *    字符串等平台特有字段），任何换名都会破坏 round-trip deep-equal。
 *  - parts 原样**引用直通**——绝不改写 part 载荷与 part.id。
 *  - 防御：已是 wire 形状的项（B2 违例回退路径会回吐原文）原样放行，
 *    判定 = info 与 parts 键共存（flat 消息不含这两个键）。
 *  - 字段零丢失：undefined 值跳过（缺省字段不输出键）、不造 id。
 */
import { MafwMessage } from './canonical-types';

/** flat 消息 → v1 wire info（全字段同名拷贝；content 不进 info）。 */
export function toWireInfo(msg: MafwMessage): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(msg)) {
    if (value === undefined) continue;
    if (key === 'content') continue; // content → parts，由 toWireHistory 处理
    info[key] = value;
  }
  return info;
}

/** flat 历史 → v1 wire 历史（parts 引用直通；content 缺省 → parts: []）。
 *  已是 wire 形状的项（info+parts 键共存）原样引用放行。 */
export function toWireHistory(
  messages: MafwMessage[],
): Array<{ info: Record<string, unknown>; parts: unknown[] }> {
  return messages.map((msg) => {
    const m = msg as unknown as Record<string, unknown>;
    if (m && typeof m === 'object' && 'info' in m && 'parts' in m) {
      return m as unknown as { info: Record<string, unknown>; parts: unknown[] };
    }
    return { info: toWireInfo(msg), parts: Array.isArray(m?.content) ? m.content : [] };
  });
}

/**
 * 事件级 egress：canonical message.updated 载荷 `{message}` → wire `{info}`
 * （SSE 广播出口唯一事件转换点，挂 mafwBroadcast）；其他事件类型载荷
 * 原样引用透传（part、permission、plugin 命名空间零改写）。
 * B2 违例回退路径（载荷无 message 键）原样放行。
 */
export function toWireEventPayload(
  type: string,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'message.updated'
    && properties && typeof properties === 'object'
    && 'message' in properties && !('info' in properties)) {
    const { message, ...rest } = properties as { message?: unknown } & Record<string, unknown>;
    return { ...rest, info: message };
  }
  return properties;
}
