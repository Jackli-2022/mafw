import { TtlMap } from '../utils/ttl-map'

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const RECALL_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/context`

// Per-session cursor: the ID of the last *real* message processed. Synthetic
// `<recall>` parts injected by this hook are appended to a real user message's
// parts (marked `synthetic:true`) and never advance the cursor. TTL releases
// entries for ended/idle sessions.
const cursorBySession = new TtlMap<string, string>(24 * 60 * 60 * 1000)

// Synthetic <recall> parts injected by this hook are appended to real user
// messages' parts (marked `synthetic:true`). Real messages always carry
// `info.id`; the <recall> text marker is kept for legacy detection.
function isInjectedMessage(msg: any): boolean {
  if (!msg?.info?.id) return true
  if (typeof msg?.content === 'string' && msg.content.trimStart().startsWith('<recall>')) return true
  return false
}

function extractText(msg: any): string {
  if (typeof msg?.content === 'string') return msg.content
  if (msg?.parts) {
    return msg.parts
      .filter((p: any) => p.type === 'text' || p.type === 'tool')
      .map((p: any) => p.text || p.content || p.input || p.output || JSON.stringify(p))
      .join(' ')
  }
  return ''
}

// Incremental messages after the cursor. If the cursor ID is gone (history
// edited/truncated), fall back to the last 8 real messages — never including
// synthetic <recall> parts — so injected pointers are not re-processed.
function getIncrementalMessages(messages: any[], lastId: string | undefined): any[] {
  const real = messages.filter((m: any) => !isInjectedMessage(m))
  if (!lastId) return real
  const idx = real.findIndex((m: any) => m.info?.id === lastId)
  if (idx === -1) return real.slice(-8)
  return real.slice(idx + 1)
}

function buildQuery(messages: any[]): string {
  return messages
    .map((m: any) => extractText(m))
    .join('\n')
    .slice(0, 500)
}

async function fetchRecall(query: string, sessionID: string): Promise<{ pointers: string | null }> {
  if (!query.trim()) return { pointers: null }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 100)
    const res = await fetch(`${RECALL_URL}?sessionID=${encodeURIComponent(sessionID)}&query=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return { pointers: null }
    const body = await res.json() as any
    return {
      pointers: body?.pointers || null,
    }
  } catch {
    return { pointers: null }
  }
}

export async function sessionRecallHook(input: any, output: any): Promise<any> {
  const messages = output?.messages || []
  if (messages.length === 0) return output

  // The transform hook input is `{}` (no sessionID); recover it from the first
  // real message's info so per-session cursors stay isolated.
  const sessionID =
    input?.sessionID ||
    (messages.find((m: any) => m.info?.sessionID)?.info?.sessionID as string | undefined) ||
    ''
  if (!sessionID) return output

  const increment = getIncrementalMessages(messages, cursorBySession.get(sessionID))
  const query = buildQuery(increment)
  if (!query.trim()) return output

  const recall = await fetchRecall(query, sessionID)

  // Advance cursor past the last real message (injected parts excluded).
  const real = messages.filter((m: any) => !isInjectedMessage(m))
  const lastReal = real[real.length - 1]
  if (lastReal?.info?.id) cursorBySession.set(sessionID, lastReal.info.id)

  if (recall.pointers) {
    // Inject into a real user message's parts (valid message shape — a bare
    // `{ role, content }` push crashes toModelMessagesEffect's parts scan).
    const lastUser = real.filter((m: any) => m.info?.role === 'user').pop()
    if (lastUser && Array.isArray(lastUser.parts)) {
      lastUser.parts.push({ type: 'text', text: recall.pointers, synthetic: true })
    }
  }

  return output
}
