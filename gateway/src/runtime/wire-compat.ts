/**
 * wire-compat —— egress 出口转换：canonical flat（MafwMessage）→ v1 wire（{info, parts[]}）。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.4
 * 本模块是 gateway **唯一**的 flat→wire 转换点，只挂在两处出口：
 *   ① SSE 广播出口（message.updated 载荷，Plan 2 接线）
 *   ② 历史 serving 出口（/api/sessions/:id/messages，Plan 1 Task 4 接线）
 *
 * 不变量：
 *  - parts 原样**引用直通**——绝不改写 part 载荷与 part.id（@v1 原生 part.id
 *    直通；assembler 合帧的 toolpart_<callID> 也原样过）。shim 只管消息层信封。
 *  - model → modelID 是唯一换名点，与 opencode-history 翻译的 modelID → model
 *    互逆（round-trip 保真）。
 *  - 字段零丢失：未声明的附加字段原样透传（Object.entries 全量拷贝），
 *    undefined 值跳过（缺省字段不输出键）、不造 id。
 */
import { MafwMessage } from './canonical-types';

/** flat 消息 → v1 wire info（全字段拷贝 + model→modelID 换名；content 不进 info）。 */
export function toWireInfo(msg: MafwMessage): Record<string, unknown> {
  const info: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(msg)) {
    if (value === undefined) continue;
    if (key === 'content') continue; // content → parts，由 toWireHistory 处理
    info[key === 'model' ? 'modelID' : key] = value;
  }
  return info;
}

/** flat 历史 → v1 wire 历史（parts 引用直通；content 缺省 → parts: []）。 */
export function toWireHistory(
  messages: MafwMessage[],
): Array<{ info: Record<string, unknown>; parts: unknown[] }> {
  return messages.map((msg) => ({
    info: toWireInfo(msg),
    parts: Array.isArray(msg.content) ? msg.content : [],
  }));
}
