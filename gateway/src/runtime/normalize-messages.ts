/**
 * session.messages 历史 DTO 归一（MAFW View DTO：出口恒 flat MafwMessage[]）。
 *
 * 声明 normalizeMessages 的 runtime（pi / claude）→ 应用其实现；未声明的
 * runtime（opencode adapter 自身已产出 flat）→ 直接校验原始项。
 *
 * 旧的第二条兼容通道（flat→wire egress、wire→flat 二次翻译、纯函数包装器）
 * 已在 Task 15 物理删除：所有 adapter 必须显式交付合法 flat DTO；违例
 * fail-closed 并记录诊断（spec 2026-11-02 §9.1）。
 */
import { isMafwMessage } from './canonical-types';

/**
 * RuntimeFacade 专用严格历史归一：只输出 flat MafwMessage，绝不回退原生 raw，
 * 也不做 wire→flat 二次翻译。
 */
export function normalizeFacadeHistory(
  runtime: any,
  rawData: unknown,
  onViolation?: (reason: string) => void,
): any[] {
  if (!Array.isArray(rawData)) {
    onViolation?.('normalizeMessages received non-array history — dropped');
    return [];
  }

  const declared = runtime?.session?.normalizeMessages;
  let items: unknown[];
  if (typeof declared === 'function') {
    try {
      const out = declared.call(runtime.session, rawData);
      if (!Array.isArray(out)) {
        onViolation?.('normalizeMessages returned non-array — dropped');
        return [];
      }
      items = out;
    } catch (err: any) {
      onViolation?.(`normalizeMessages threw: ${err?.message ?? String(err)} — dropped`);
      return [];
    }
  } else {
    items = rawData;
  }

  const result: any[] = [];
  for (const item of items) {
    if (isMafwMessage(item)) {
      result.push(item);
    } else {
      onViolation?.('normalizeMessages produced a non-flat member — dropped');
    }
  }
  return result;
}
