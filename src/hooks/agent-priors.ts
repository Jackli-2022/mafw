// W1 常驻先验块注入：拉取 gateway 的 <agent-priors> 并追加到 system 尾部
// （在 memory-guide 与 <user-profile> 之后——半稳定内容靠后保前缀缓存）。
// fail-open：任何错误/超时 = 本轮无先验块，绝不阻塞 LLM 流程。

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const PRIORS_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/priors`

export async function agentPriorsSystemHook(_input: any, output: any): Promise<any> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 150)
    const res = await fetch(PRIORS_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return output
    const body = (await res.json()) as any
    if (body?.block) {
      if (!output.system) output.system = []
      output.system.push(body.block)
    }
  } catch {
    // fail-open: gateway down / timeout → no priors block this turn
  }
  return output
}
