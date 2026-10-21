/**
 * opencode-history —— opencode serve 历史 wire（{info, parts}[]）→ flat（MafwMessage[]）。
 *
 * 零换名裁决（ledger Task 4，SDK types.gen.d.ts 实证）：UserMessage.model 为
 * 对象 {providerID, modelID, variant?}、AssistantMessage.modelID 为字符串——
 * 翻译 = 纯信封搬移：info 字段全量同名展开到消息顶层（平台特有字段
 * modelID/model/agent/mode/path/summary… 原样透传），parts → content 引用
 * 直通（部件零拷贝零改写）。逆变换 = wire-compat.toWireInfo/toWireHistory。
 *
 * 同时充当 normalize-messages 的**默认归一器**：未声明 normalizeMessages 的
 * runtime（opencode 恒等路径、legacy 文件插件）经它把 wire 形状翻译为 flat，
 * 使 session.messages 出口形状恒定（canonical v3 内部契约）；非 {info, parts}
 * 形状的项逐项原样放行（已是 flat 或异形数据，交 B2 守卫判定）。
 */
import { MafwMessage } from './canonical-types';

export function normalizeOpencodeHistory(raw: any[]): MafwMessage[] {
  if (!Array.isArray(raw)) return raw;
  return raw.map((m: any) => {
    if (m && typeof m === 'object' && 'info' in m && 'parts' in m) {
      // 纯信封搬移：{info: {...}, parts: [...]} → {...info 字段, content: parts}
      return { ...m.info, content: m.parts } as MafwMessage;
    }
    return m as MafwMessage;
  });
}
