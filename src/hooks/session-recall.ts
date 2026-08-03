import { setPendingConstraints } from './session-system'

const GATEWAY_PORT = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000'
const RECALL_URL = `http://127.0.0.1:${GATEWAY_PORT}/api/recall/context`

let lastBoundaryIndex = 0

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

function getIncrementalQuery(messages: any[], boundaryIndex: number): string {
  const increment = messages.slice(boundaryIndex)
  if (increment.length === 0) return ''
  return increment
    .map((m: any) => extractText(m))
    .join('\n')
    .slice(0, 500)
}

async function fetchRecall(query: string, sessionID: string): Promise<{ pointers: string | null; constraints: string | null }> {
  if (!query.trim()) return { pointers: null, constraints: null }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 100)
    const res = await fetch(`${RECALL_URL}?sessionID=${encodeURIComponent(sessionID)}&query=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return { pointers: null, constraints: null }
    const body = await res.json() as any
    return {
      pointers: body?.pointers || null,
      constraints: body?.constraints || null,
    }
  } catch {
    return { pointers: null, constraints: null }
  }
}

export async function sessionRecallHook(input: any, output: any): Promise<any> {
  const messages = output?.messages || []
  const sessionID = input?.sessionID || ''
  if (!sessionID || messages.length === 0) return output

  const query = getIncrementalQuery(messages, lastBoundaryIndex)
  if (!query) return output

  const recall = await fetchRecall(query, sessionID)
  if (recall.pointers) {
    messages.push({
      role: 'user',
      content: recall.pointers,
    })
  }
  if (recall.constraints) {
    setPendingConstraints(recall.constraints)
  }

  lastBoundaryIndex = messages.length
  return output
}
