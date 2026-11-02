/**
 * opencode-history —— opencode serve 历史 wire（{info, parts}[]）→ flat（MafwMessage[]）。
 *
 * 零换名裁决（ledger Task 4，SDK types.gen.d.ts 实证）：UserMessage.model 为
 * 对象 {providerID, modelID, variant?}、AssistantMessage.modelID 为字符串——
 * 翻译 = 纯信封搬移：info 字段全量同名展开到消息顶层（平台特有字段
 * modelID/model/agent/mode/path/summary… 原样透传），parts → content 引用
 * 直通（部件零拷贝零改写，规范字段由 opencode-canonical 补齐）。
 *
 * adapter 职责：opencode adapter 在 `session.messages` 内联同一信封搬移 +
 * role/user-text 归一（2.1 方言）。本模块保留为标准翻译参考实现与 golden
 * 对照（Task 15 删除了 egress/默认归一器的生产接线，但没有删除原生翻译）。
 */
import { MafwMessage } from './canonical-types';
import { canonicalMessage } from './opencode-canonical';

export function normalizeOpencodeHistory(raw: any[]): MafwMessage[] {
  if (!Array.isArray(raw)) return raw;
  return raw.map((m: any) => {
    if (m && typeof m === 'object' && 'info' in m && 'parts' in m) {
      // 纯信封搬移：{info: {...}, parts: [...]} → {...info 字段, content: parts}
      // 之后补 MAFW 规范字段（model/stopReason/error/工具 output）——见
      // opencode-canonical（原生字段保留在兼容窗口）。
      return canonicalMessage({ ...m.info, content: m.parts }) as MafwMessage;
    }
    return canonicalMessage(m) as MafwMessage;
  });
}
