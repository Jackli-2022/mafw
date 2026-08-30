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

/**
 * Group memories by type for better cross-session visibility.
 * Multi-session queries benefit from seeing memories organized by topic.
 */
function groupMemoriesByType(memories: MemoryUnit[]): Map<string, MemoryUnit[]> {
  const groups = new Map<string, MemoryUnit[]>();
  for (const m of memories) {
    const type = m.type || 'other';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type)!.push(m);
  }
  return groups;
}

export function formatRecallContext(memories: MemoryUnit[]): RecallFormat {
  if (memories.length === 0) return { pointers: null }

  // For multi-type results, group by type for better readability
  const groups = groupMemoriesByType(memories)
  const lines: string[] = []
  
  // If all same type, flat list (backward compatible)
  if (groups.size <= 1) {
    lines.push(...memories.slice(0, 3).map(pointerLine))
  } else {
    // Multi-type: group with headers
    for (const [type, mems] of groups) {
      if (mems.length === 0) continue;
      lines.push(`[${type}]`)
      for (const m of mems.slice(0, 2)) {
        lines.push(`  ${pointerLine(m)}`)
      }
    }
  }

  const pointers = `${TAG}\n${POINTER_HEADER}\n${lines.slice(0, 5).join('\n')}\n${END_TAG}`
  return { pointers }
}

// ---- Pinned disclosure profile rendering (GET /api/recall/pinned) ----

export const PINNED_BUDGET = { max: 20, maxChars: 2000 } as const;

const PROFILE_TAG = '<user-profile>';
const PROFILE_END_TAG = '</user-profile>';

/**
 * Renders pinned memories into the <user-profile> disclosure block.
 * Enforces the hard budget (max entries / max chars); entries beyond the
 * budget are dropped (caller logs the overflow count). Returns null profile
 * for an empty set — callers must not inject an empty block.
 */
export function formatPinnedProfile(entries: MemoryUnit[]): { profile: string | null; used: number } {
  const lines: string[] = [];
  let chars = 0;
  for (const m of entries.slice(0, PINNED_BUDGET.max)) {
    const text = (m.memory_value || m.primary_abstraction || '?').replace(/\n/g, ' ');
    const line = `- ${text}`;
    if (chars + line.length > PINNED_BUDGET.maxChars) break;
    lines.push(line);
    chars += line.length;
  }
  if (lines.length === 0) return { profile: null, used: 0 };
  return { profile: `${PROFILE_TAG}\n${lines.join('\n')}\n${PROFILE_END_TAG}`, used: lines.length };
}
