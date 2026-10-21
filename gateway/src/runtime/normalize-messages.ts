/**
 * session.messages 历史 DTO 归一（canonical v3：出口恒 flat MafwMessage[]）。
 *
 * 声明 normalizeMessages 的 runtime（pi）→ 应用其实现；未声明的 runtime
 * （opencode 恒等路径、legacy 文件插件）→ 应用默认 wire→flat 翻译
 * （opencode-history.normalizeOpencodeHistory）——两条路径汇合到同一
 * flat 契约，egress 出口（wire-compat.toWireHistory）是唯一还原点。
 *
 * B2 输出守卫：非数组 / 成员非 flat MafwMessage / 抛错 → onViolation +
 * 回退原文（历史可用性不破坏；egress 的 wire 形状放行防御兜住回退路径）。
 */
import { isMafwMessage } from './canonical-types';
import { normalizeOpencodeHistory } from './opencode-history';

export function applyNormalizeMessages(
  runtime: any,
  rawData: any[],
  onViolation?: (reason: string) => void,
): any[] {
  const declared = runtime?.session?.normalizeMessages;
  const fn = typeof declared === 'function' ? declared : normalizeOpencodeHistory;
  try {
    const out = fn.call(runtime?.session, rawData);
    if (!Array.isArray(out)) {
      onViolation?.('normalizeMessages returned non-array — falling back to raw data');
      return rawData;
    }
    if (!out.every((m: any) => isMafwMessage(m))) {
      // 二次翻译：老契约插件（flat 契约发布前的 {info,parts} wire 输出）救回——
      // 直接回退 native raw 会在 egress 出口被拍碎（content 键被 shim 跳过）。
      // 可观测：onViolation 计数提示插件作者迁移，但不阻断数据。
      try {
        const rescued = normalizeOpencodeHistory(out);
        if (Array.isArray(rescued) && rescued.every((m: any) => isMafwMessage(m))) {
          onViolation?.('normalizeMessages returned wire-shaped legacy output — second-chance translated to flat (migrate plugin to flat contract)');
          return rescued;
        }
      } catch { /* fall through to raw fallback */ }
      onViolation?.('normalizeMessages returned non-flat MafwMessage shapes — falling back to raw data');
      return rawData;
    }
    return out;
  } catch (err: any) {
    onViolation?.(`normalizeMessages threw: ${err?.message ?? String(err)}`);
    return rawData;
  }
}

/**
 * 收口 runtime.session.messages：出口形状恒为 flat（canonical v3）。
 * 所有消费者（desktop 路由经 egress shim / waitwhat / trajectory / eval /
 * media）拿到的形状一致。幂等（重复调用不再包）。
 */
export function wrapRuntimeMessages(rt: any, onViolation?: (reason: string) => void): void {
  const session = rt?.session;
  if (!session || typeof session.messages !== 'function') return;
  if (session.__mafwMessagesWrapped) return;
  const orig = session.messages.bind(session);
  session.messages = async (opts: any) => {
    const result = await orig(opts);
    const data = result?.data;
    if (!Array.isArray(data)) return result;
    return { ...result, data: applyNormalizeMessages(rt, data, onViolation) };
  };
  session.__mafwMessagesWrapped = true;
}
