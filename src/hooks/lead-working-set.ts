// Per-turn Lead working-set injection.
//
// The gateway decides whether the session is a Lead session and returns the
// already-budgeted blocks. This hook is intentionally tiny and fail-open: a
// slow/broken gateway must never delay the first token (100ms hard budget).

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const CONTEXT_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/lead/context`
const SEEN_LIMIT = 100

const seen = new Map<string, true>()

function remember(key: string): void {
  seen.set(key, true)
  while (seen.size > SEEN_LIMIT) {
    const oldest = seen.keys().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
}

function textOf(parts: any[]): string {
  return parts
    .filter((part) => part?.type === 'text' && part.synthetic !== true && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('\n')
    .trim()
}

type FetchLike = (input: any, init?: any) => Promise<any>

function lastUserMessage(messages: any[]): any | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.info?.role === 'user' && Array.isArray(message.parts)) return message
  }
  return null
}

export async function leadWorkingSetHook(
  input: { sessionID?: string },
  output: { messages?: any[] },
  deps: { fetchImpl?: FetchLike } = {},
): Promise<void> {
  try {
    const messages = Array.isArray(output?.messages) ? output.messages : []
    if (messages.length === 0) return
    const user = lastUserMessage(messages)
    if (!user) return
    const sessionID = input?.sessionID || user?.info?.sessionID || ''
    if (!sessionID) return
    const query = textOf(user.parts).slice(0, 500)
    if (!query) return

    const key = `${sessionID}:${query}`
    if (seen.has(key)) return

    const fetchImpl = deps.fetchImpl ?? fetch
    const url = `${CONTEXT_URL}?sessionID=${encodeURIComponent(sessionID)}&query=${encodeURIComponent(query)}`
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(100) })
    if (!response.ok) return
    const body = await response.json() as any
    const blocks = Array.isArray(body?.blocks) ? body.blocks : []
    const text = blocks
      .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n\n')
    if (!text) return

    user.parts.push({ type: 'text', text, synthetic: true })
    remember(key)
  } catch {
    // Fail-open: no working-set block on timeout/parse/network errors.
  }
}
