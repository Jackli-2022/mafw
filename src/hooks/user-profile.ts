// Disclosure layer injection: fetches the pinned <user-profile> block from the
// gateway and appends it to the system prompt (after <memory-guide>, so the
// static prefix stays cacheable). Fail-open: any error/timeout means no block,
// never an exception — LLM flow must not be blocked by memory injection.

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const PINNED_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/pinned`

export async function userProfileSystemHook(_input: any, output: any): Promise<any> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 150)
    const res = await fetch(PINNED_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return output
    const body = await res.json() as any
    if (body?.profile) {
      if (!output.system) output.system = []
      output.system.push(body.profile)
    }
  } catch {
    // fail-open: gateway down / timeout → no disclosure block this turn
  }
  return output
}
