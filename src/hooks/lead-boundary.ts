// Async, fail-open topic-boundary observation from the host plugin.
// The gateway decides whether to propose; the hook must never block a turn.

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const OBSERVE_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/lead/boundaries/observe`

export async function leadBoundaryHook(
  input: { sessionID?: string; text?: string },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  try {
    const sessionID = input?.sessionID || ''
    const text = input?.text || ''
    if (!sessionID || !text.trim()) return
    const fetchImpl = deps.fetchImpl ?? fetch
    await fetchImpl(OBSERVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionID, text }),
      signal: AbortSignal.timeout(100),
    })
  } catch {
    // Fail-open: boundary detection is advisory.
  }
}
