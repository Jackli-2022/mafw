interface MemoryUnit {
  id?: string
  primary_abstraction?: string
  cue_anchors?: string[]
  memory_value?: string
  energy?: number
  type?: string
  created_at?: string
}

export interface RecallFormat {
  pointers: string | null
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  } catch {
    return ''
  }
}

function pointerLine(m: MemoryUnit): string {
  const tags: string[] = []
  const date = formatDate(m.created_at)
  if (date) tags.push(date)
  if (m.type) tags.push(m.type)
  const tagStr = tags.length > 0 ? `[${tags.join(' ')}] ` : ''
  const text = (m.primary_abstraction || m.memory_value || '?').replace(/\n/g, ' ')
  const energy = typeof m.energy === 'number' ? m.energy.toFixed(1) : '?'
  return `- #mem-${(m.id || '?').slice(0, 6)} ${tagStr}"${text}" (E:${energy})`
}

// ---- Memory block rendering (shared by all full-content injection paths) ----

export interface MemoryBlockEntry {
  source?: string
  type?: string
  content?: string
  rule?: string
  prompt_delta?: string
  pattern_template?: string
  pattern?: string
  facts?: string[]
  summary?: string
  successRate?: number
  verdict?: string
  loopNum?: number
  energy?: number
  id?: string
}

type BlockTag = 'deltas' | 'patterns' | 'facts' | 'history'

// Maps an entry to its block bucket. Order matters: parametric/delta entries go
// to <deltas>, procedural patterns to <patterns>, episodic/history to
// <history>, everything else to <facts>. Mirrors the classification used by
// the gateway first-turn transform.
function bucketFor(entry: MemoryBlockEntry): BlockTag {
  if (entry.source === 'parametric' || entry.type === 'delta' || entry.type === 'constraint' || entry.type === 'prompt') return 'deltas'
  if (entry.source === 'procedural' || entry.type === 'pattern') return 'patterns'
  if (entry.source === 'episodic' || entry.type === 'history' || entry.type === 'review' || entry.verdict) return 'history'
  return 'facts'
}

function lineFor(entry: MemoryBlockEntry): string {
  switch (bucketFor(entry)) {
    case 'deltas':
      return `[Δ ${entry.type || 'constraint'}] ${entry.content || entry.rule || entry.prompt_delta || entry.pattern_template || ''}`
    case 'patterns':
      return `[${((entry.successRate || 0) * 100).toFixed(0)}%] ${entry.pattern || entry.content || ''}`
    case 'history':
      return `Loop ${entry.loopNum || '?'}: ${entry.verdict || '?'} ☑ ${entry.summary || entry.content || ''}`
    case 'facts': {
      const content = (entry.facts && entry.facts.length ? entry.facts.join('; ') : entry.content) || ''
      return content ? `☑ ${content}` : ''
    }
  }
}

/**
 * Renders a list of memory entries into XML block strings, one per bucket:
 * `<deltas>`, `<patterns>`, `<facts>`, `<history>`. Empty buckets are omitted.
 * Callers join with "\n\n".
 */
export function renderMemoryBlocks(entries: MemoryBlockEntry[]): string[] {
  const buckets: Record<BlockTag, string[]> = { deltas: [], patterns: [], facts: [], history: [] }
  for (const entry of entries) {
    const line = lineFor(entry)
    if (line.trim()) buckets[bucketFor(entry)].push(line)
  }
  const chunks: string[] = []
  for (const tag of ['deltas', 'patterns', 'facts', 'history'] as const) {
    if (buckets[tag].length > 0) chunks.push(`<${tag}>\n${buckets[tag].join('\n')}\n</${tag}>`)
  }
  return chunks
}

// ---- Pointer rendering (boundary recall) ----

const POINTER_HEADER = `[联想线索 · 依据前请用工具验证]`

const TAG = `<recall>`
const END_TAG = `</recall>`

export function formatRecallContext(memories: MemoryUnit[]): RecallFormat {
  const pointers = memories.length > 0
    ? `${TAG}\n${POINTER_HEADER}\n${memories.slice(0, 3).map(pointerLine).join('\n')}\n${END_TAG}`
    : null

  return { pointers }
}
