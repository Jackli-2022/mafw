interface MemoryUnit {
  id?: string
  primary_abstraction?: string
  cue_anchors?: string[]
  memory_value?: string
  energy?: number
  type?: string
  created_at?: string
  source_session_id?: string
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
  // ids are `mem_<timestamp>_<rand>` — the FIRST 6 chars are constant across
  // every memory; use the tail so pointers stay unique and verifiable.
  return `- #mem-${(m.id || '?').slice(-6)} ${tagStr}"${text}" (E:${energy})`
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

const POINTER_HEADER = `[联想线索 · 依据前请验证：取全文 → mafw_get_memory("#mem-后6位")；检索更多 → mafw_search_hybrid]`

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

  // Episodic grouping: memories sharing a source session render under one
  // session header with a date range (Memora-style narrative recovery —
  // multi-session questions need to see that two hits came from one episode).
  const sessionGroups = new Map<string, MemoryUnit[]>()
  for (const m of memories) {
    if (!m.source_session_id) continue
    if (!sessionGroups.has(m.source_session_id)) sessionGroups.set(m.source_session_id, [])
    sessionGroups.get(m.source_session_id)!.push(m)
  }
  const groupedIds = new Set<string>()
  for (const mems of sessionGroups.values()) {
    if (mems.length < 2) continue
    for (const m of mems) groupedIds.add(m.id!)
  }

  const groups = groupMemoriesByType(memories)
  const lines: string[] = []
  let sessionHeaders = 0

  for (const [sessionId, mems] of sessionGroups) {
    if (mems.length < 2) continue
    const dates = mems.map(m => formatDate(m.created_at)).filter(Boolean).sort()
    const range = dates.length >= 2 && dates[0] !== dates[dates.length - 1]
      ? `${dates[0]}~${dates[dates.length - 1]}`
      : dates[0] ?? ''
    lines.push(`[session ${sessionId.slice(0, 8)}${range ? ' · ' + range : ''}]`)
    for (const m of mems) {
      lines.push(`  ${pointerLine(m)}`)
    }
    sessionHeaders++
  }

  // Everything else (ungrouped or singletons) renders as before.
  const rest = memories.filter(m => !groupedIds.has(m.id!))
  const restGroups = groupMemoriesByType(rest)
  if (restGroups.size <= 1 && sessionHeaders === 0) {
    lines.push(...rest.slice(0, 3).map(pointerLine))
  } else if (rest.length > 0) {
    for (const [type, mems] of restGroups) {
      if (mems.length === 0) continue
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

// ---- Sticky note board rendering (appended to /api/recall/context) ----

export const NOTE_BOARD_BUDGET = { max: 10, maxChars: 800 } as const;

const BOARD_TAG = '<note-board>';
const BOARD_END_TAG = '</note-board>';

export interface NoteBoardEntry extends MemoryUnit {
  sticky_until?: string;
}

/**
 * Renders sticky notes into the <note-board> block: guaranteed per-turn
 * visibility for user-commissioned memories until their sticky_until passes.
 * Board-level expiry only — the memory itself is never deleted or hidden
 * from search. Enforces a hard budget; returns null board for an empty set.
 * `now` is injectable for deterministic tests.
 */
export function formatNoteBoard(entries: NoteBoardEntry[], now: Date = new Date()): { board: string | null; used: number } {
  const lines: string[] = [];
  let chars = 0;
  for (const m of entries.slice(0, NOTE_BOARD_BUDGET.max)) {
    const text = (m.memory_value || m.primary_abstraction || '?').replace(/\n/g, ' ');
    const until = m.sticky_until ? new Date(m.sticky_until) : null;
    const valid = until && !Number.isNaN(until.getTime());
    const daysLeft = valid ? Math.max(0, Math.ceil((until!.getTime() - now.getTime()) / 86400e3)) : null;
    const date = valid ? formatDate(m.sticky_until) : '';
    const line = `- ${date ? `[${date.slice(5)}] ` : ''}${text}${daysLeft !== null ? `（剩 ${daysLeft} 天）` : ''}`;
    if (chars + line.length > NOTE_BOARD_BUDGET.maxChars) break;
    lines.push(line);
    chars += line.length;
  }
  if (lines.length === 0) return { board: null, used: 0 };
  return {
    board: `${BOARD_TAG}\n[用户叮嘱 · 到期自动下架，记忆本体保留]\n${lines.join('\n')}\n${BOARD_END_TAG}`,
    used: lines.length,
  };
}
