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
