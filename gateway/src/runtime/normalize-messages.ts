/**
 * session.messages 历史 DTO 归一：runtime 声明 normalizeMessages 则应用，否则恒等。
 * fail-open——归一抛错时回退原始数据，绝不让历史加载失败。
 */
export function applyNormalizeMessages(runtime: any, rawData: any[]): any[] {
  const fn = runtime?.session?.normalizeMessages;
  if (typeof fn !== 'function') return rawData;
  try {
    return fn.call(runtime.session, rawData);
  } catch {
    return rawData;
  }
}

/**
 * 收口 runtime.session.messages：声明了 normalizeMessages 的 runtime，其历史数据
 * 在出口处统一归一为 opencode {info, parts} DTO。所有消费者（desktop 路由 / waitwhat /
 * trajectory / eval / media）拿到的形状一致。opencode 无该方法 → 不包装，零风险。
 * 幂等（重复调用不再包）。
 */
export function wrapRuntimeMessages(rt: any): void {
  const session = rt?.session;
  if (!session || typeof session.messages !== 'function') return;
  if (typeof session.normalizeMessages !== 'function') return;
  if (session.__mafwMessagesWrapped) return;
  const orig = session.messages.bind(session);
  session.messages = async (opts: any) => {
    const result = await orig(opts);
    const data = result?.data;
    if (!Array.isArray(data)) return result;
    return { ...result, data: applyNormalizeMessages(rt, data) };
  };
  session.__mafwMessagesWrapped = true;
}
