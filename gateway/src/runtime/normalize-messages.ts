/**
 * session.messages 历史 DTO 归一：runtime 声明 normalizeMessages 则应用，否则恒等。
 * B2 输出守卫：非数组 / 成员缺 parts 数组 / 抛错 → onViolation + 回退原文（历史可用性不破坏）。
 */
export function applyNormalizeMessages(
  runtime: any,
  rawData: any[],
  onViolation?: (reason: string) => void,
): any[] {
  const fn = runtime?.session?.normalizeMessages;
  if (typeof fn !== 'function') return rawData;
  try {
    const out = fn.call(runtime.session, rawData);
    if (!Array.isArray(out)) {
      onViolation?.('normalizeMessages returned non-array — falling back to raw data');
      return rawData;
    }
    if (!out.every((m: any) => m && typeof m === 'object' && Array.isArray(m.parts))) {
      onViolation?.('normalizeMessages returned non-{info, parts[]} shapes — falling back to raw data');
      return rawData;
    }
    return out;
  } catch (err: any) {
    onViolation?.(`normalizeMessages threw: ${err?.message ?? String(err)}`);
    return rawData;
  }
}

/**
 * 收口 runtime.session.messages：声明了 normalizeMessages 的 runtime，其历史数据
 * 在出口处统一归一为 opencode {info, parts} DTO。所有消费者（desktop 路由 / waitwhat /
 * trajectory / eval / media）拿到的形状一致。opencode 无该方法 → 不包装，零风险。
 * 幂等（重复调用不再包）。
 */
export function wrapRuntimeMessages(rt: any, onViolation?: (reason: string) => void): void {
  const session = rt?.session;
  if (!session || typeof session.messages !== 'function') return;
  if (typeof session.normalizeMessages !== 'function') return;
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
