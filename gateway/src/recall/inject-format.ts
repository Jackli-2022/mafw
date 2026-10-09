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

/** R5 FOK zone (mirrors recall/fok-gate.ts; inlined to avoid a cycle). */
export type RecallFokStatus = 'inject' | 'low-confidence' | 'no-memory'

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

// R5 FOK gate: weak evidence must be *stated*, never silently withheld
// (silence invites confabulation — the brain's mPFC monitor exists precisely
// to flag "I don't actually know"). Measured refinement (LongMemEval L2,
// 2026-09-28): the candidates must be KEPT as well — withholding them cost
// answerable accuracy (-20pt on the affected zone) and even *lowered*
// abstention accuracy (0.933 vs 0.967) because the reader needs the evidence
// to confirm the information is absent. Declare, don't withhold.
const RELIABLE_OPEN = `<recall status="no-reliable-memory">`
const RELIABLE_NOTE = `[无可靠记忆 · 不要臆造：下列线索可能与问题无关，据此下结论前先核实；可换关键词 mafw_search_hybrid 再试，仍无 → 直说不知道或 mafw_ask_user]`
const NO_RELIABLE_POINTERS = `${RELIABLE_OPEN}\n${RELIABLE_NOTE}\n</recall>`
const LOW_CONFIDENCE_NOTE = `[置信度低 · 下列线索可能与问题无关，据此下结论前先核实]`

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

export interface FormatRecallOptions {
  /**
   * R5 FOK zone from the retrieval score distribution. 'no-memory' KEEPS the
   * candidates but marks the block `status="no-reliable-memory"` with a
   * no-fabrication note (measured: withholding hurts both sides);
   * 'low-confidence' prepends a caution note; 'inject' = unchanged.
   */
  status?: RecallFokStatus
  /**
   * R6 presentation: anchor memory id → its chronological neighbours, rendered
   * as `↳` lines beneath the anchor. Neighbours never compete for ranking, so
   * this is presentation-only (CueMem/EdgeMem style context reinstatement).
   */
  neighbors?: Map<string, MemoryUnit[]>
}

/** R6 presentation budget: neighbour lines are capped so they never crowd out
 *  genuine hits (spec: neighbour tokens ≤ 50% of the block budget). */
export const NEIGHBOR_BUDGET = { maxLines: 4 } as const
const RECENT_PREFERENCE_NOTE = `[知识更新 · 同一事实有多个版本时，优先采用离问题时间最近的信息，不要把旧版本当成现状]`

interface RenderLine {
  text: string
  /** Anchor memory id (set for pointer lines, absent for headers). */
  id?: string
  neighbor?: boolean
}

export function formatRecallContext(memories: MemoryUnit[], options: FormatRecallOptions = {}): RecallFormat {
  const status = options.status
  // Empty + no-memory: the retrieval produced nothing at all — the status block
  // is then the only content there is.
  if (status === 'no-memory' && memories.length === 0) return { pointers: NO_RELIABLE_POINTERS }
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
  const lines: RenderLine[] = []
  let sessionHeaders = 0

  // R6: neighbour lines follow their anchor (capped globally, never ranked).
  let neighborCount = 0
  const pushNeighbors = (m: MemoryUnit) => {
    const nbs = options.neighbors?.get(m.id ?? '')
    if (!nbs || nbs.length === 0) return
    for (const nb of nbs.slice(0, 2)) {
      if (neighborCount >= NEIGHBOR_BUDGET.maxLines) return
      lines.push({ text: `  ↳ ${pointerLine(nb)}`, id: nb.id, neighbor: true })
      neighborCount++
    }
  }

  for (const [sessionId, mems] of sessionGroups) {
    if (mems.length < 2) continue
    const dates = mems.map(m => formatDate(m.created_at)).filter(Boolean).sort()
    const range = dates.length >= 2 && dates[0] !== dates[dates.length - 1]
      ? `${dates[0]}~${dates[dates.length - 1]}`
      : dates[0] ?? ''
    lines.push({ text: `[session ${sessionId.slice(0, 8)}${range ? ' · ' + range : ''}]` })
    for (const m of mems) {
      lines.push({ text: `  ${pointerLine(m)}`, id: m.id })
      pushNeighbors(m)
    }
    sessionHeaders++
  }

  // Everything else (ungrouped or singletons) renders as before.
  const rest = memories.filter(m => !groupedIds.has(m.id!))
  const restGroups = groupMemoriesByType(rest)
  if (restGroups.size <= 1 && sessionHeaders === 0) {
    for (const m of rest.slice(0, 3)) {
      lines.push({ text: pointerLine(m), id: m.id })
      pushNeighbors(m)
    }
  } else if (rest.length > 0) {
    for (const [type, mems] of restGroups) {
      if (mems.length === 0) continue
      lines.push({ text: `[${type}]` })
      for (const m of mems.slice(0, 2)) {
        lines.push({ text: `  ${pointerLine(m)}`, id: m.id })
        pushNeighbors(m)
      }
    }
  }

  // Budget: ≤5 anchor lines, neighbour lines already capped; headers always kept.
  let anchors = 0
  const capped = lines.filter(l => {
    if (l.neighbor) return true
    if (!l.id) return true
    if (anchors >= 5) return false
    anchors++
    return true
  })

  // R5 FOK: declare weak evidence without withholding the candidates.
  const tag = status === 'no-memory' ? RELIABLE_OPEN : TAG
  const header = status === 'low-confidence'
    ? `${POINTER_HEADER}\n${LOW_CONFIDENCE_NOTE}`
    : status === 'no-memory'
      ? `${RELIABLE_NOTE}\n${POINTER_HEADER}`
      : POINTER_HEADER
  const footer = neighborCount > 0 ? `\n${RECENT_PREFERENCE_NOTE}` : ''
  const pointers = `${tag}\n${header}\n${capped.map(l => l.text).join('\n')}${footer}\n${END_TAG}`
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

// maxChars 1600 ≈ 800-1200 tok/turn（中文 ≈1 字/token），低于 pinned 的 2000
// 保持"pinned=长期身份 > sticky=近期提醒"的层级。perNoteCap 是防饿死关键：
// 无上限时一条超长便签吃光总预算，后续条目全部被 break 丢弃（实证 bug）。
export const NOTE_BOARD_BUDGET = { max: 10, maxChars: 1600, perNoteCap: 240 } as const;

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
    let text = (m.memory_value || m.primary_abstraction || '?').replace(/\n/g, ' ');
    if (text.length > NOTE_BOARD_BUDGET.perNoteCap) {
      // 单条截断防饿死：板上只留前 240 字；完整内容 NotesDock/get_memory 可看
      text = `${text.slice(0, NOTE_BOARD_BUDGET.perNoteCap)}…`;
    }
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

// ---- W1 常驻先验块（<agent-priors>，system 每轮注入）----

export const AGENT_PRIORS_BUDGET = { maxAxioms: 5, maxPatterns: 5, maxChars: 800 } as const;

/**
 * W1 常驻先验块：把蒸馏产物（L5 公理/启发式 + L2 失败模式谱）渲染为每轮常驻
 * system 的小块。与 <memory-guide>/<user-profile> 一样稳定靠前以保前缀缓存。
 * 预算小而高浓度——细节仍走检索，此处只放"行动先验"。
 */
export function formatAgentPriors(input: {
  axioms: string[];
  heuristics: string[];
  failurePatterns: string[];
}): { block: string | null; used: number } {
  const lines: string[] = [];
  let chars = 0;
  let used = 0;
  const push = (line: string): boolean => {
    if (chars + line.length > AGENT_PRIORS_BUDGET.maxChars) return false;
    lines.push(line);
    chars += line.length + 1;
    used++;
    return true;
  };
  for (const a of input.axioms.slice(0, AGENT_PRIORS_BUDGET.maxAxioms)) if (!push(`- [公理] ${a}`)) break;
  for (const h of input.heuristics.slice(0, AGENT_PRIORS_BUDGET.maxAxioms)) if (!push(`- [启发式] ${h}`)) break;
  for (const f of input.failurePatterns.slice(0, AGENT_PRIORS_BUDGET.maxPatterns)) if (!push(`- [勿再犯] ${f}`)) break;
  if (lines.length === 0) return { block: null, used: 0 };
  return {
    block: `<agent-priors>\n## 行动先验（长期记忆蒸馏，常驻）\n${lines.join('\n')}\n</agent-priors>`,
    used,
  };
}
