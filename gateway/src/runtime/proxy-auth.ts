/**
 * 反向代理鉴权注入（opencode 2.1.0）。
 *
 * gateway 的兜底反代把未映射路由转发到 serve；2.1.0 起 serve 全 API 强制
 * HTTP Basic（OPENCODE_SERVER_PASSWORD），而入站 Authorization 可能是
 * gateway 自身的 token / 旧客户端头，必须剔除后注入 serve 的 Basic 头，
 * 否则反代路由（如 /api/model、/api/agent）恒 401。
 */
export function injectServeAuth(
  incoming: Record<string, any> | undefined,
  auth: Record<string, string>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (k.toLowerCase() === 'authorization') continue;
    out[k] = v;
  }
  return { ...out, ...auth };
}
