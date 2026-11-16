// 决定记录的数据源：唯一读取 attention 投影，rail badge 与 Goal 详情的决定记录共用。
import { createSignal } from "solid-js"
import type {
  AttentionItem,
  AttentionList,
  DecisionList,
  DecisionRecord,
} from "@mafw/sdk"
import { buildDecisionBoard, type DecisionBoardView } from "./focus/decision-model"

const DECISION_EVENT_ACTIONS = new Set(["drafted", "confirmed", "shelved", "reopened"])
const DECISION_RECORD_STATUSES = new Set(["draft", "decided", "shelved"])

/** Attention projections may carry a status/summary face for decision items;
 *  patch only the fields the item actually has (schema-tolerant). */
type AttentionPatchable = AttentionItem & { status?: unknown; summary?: unknown }

/** Project dirs travel through gateway canonicalization; compare loosely. */
function canonicalDir(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

/**
 * E6-3: `decision.updated` carries the full record (`properties.record`, or a
 * bare payload with `action` + `record`). Validate just enough to trust it.
 */
function readDecisionEvent(event: unknown): { action: string; record: DecisionRecord } | null {
  if (!event || typeof event !== "object") return null
  const payload = event as Record<string, unknown>
  const properties = payload.properties && typeof payload.properties === "object"
    ? payload.properties as Record<string, unknown>
    : null
  const source = properties ?? payload
  const action = source.action
  if (typeof action !== "string" || !DECISION_EVENT_ACTIONS.has(action)) return null
  const candidate = (source.record ?? payload.record) as DecisionRecord | undefined
  if (!candidate || typeof candidate !== "object") return null
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null
  if (typeof candidate.status !== "string" || !DECISION_RECORD_STATUSES.has(candidate.status)) return null
  if (typeof candidate.updatedAt !== "string" || !Number.isFinite(Date.parse(candidate.updatedAt))) return null
  return { action, record: candidate }
}

export function createDecisionStore(deps: {
  api: {
    attention(projectDir: string): Promise<AttentionList>
    decisions?(projectDir: string, goalId?: string): Promise<DecisionList>
    confirm?(id: string, input: { projectDir: string; rationale: string; consequences: string; reviewAt?: string }): Promise<unknown>
    shelve?(id: string, input: { projectDir: string; reviewAt: string; note?: string }): Promise<unknown>
    reopen?(id: string, input: { projectDir: string }): Promise<unknown>
  }
  projectDir(): string | null
}) {
  const [items, setItems] = createSignal<readonly AttentionItem[]>([])
  const [records, setRecords] = createSignal<readonly DecisionRecord[]>([])
  const [revision, setRevision] = createSignal(0)
  const [loaded, setLoaded] = createSignal(false)
  let seq = 0
  let dataDir: string | null = null

  const board = (goalId?: string | null): DecisionBoardView =>
    buildDecisionBoard({ attention: items(), records: records(), goalId })

  const counts = () => board().counts

  /**
   * E6-3: apply a single `decision.updated` in place. Returns true when the
   * event was fully handled (no refetch needed); false tells the caller to fall
   * back to `refresh()` (older gateway without `record`).
   */
  function ingest(event: unknown): boolean {
    const parsed = readDecisionEvent(event)
    if (!parsed) return false
    const incoming = parsed.record
    const dir = deps.projectDir()
    if (!dir) return false
    if (typeof incoming.projectDir === "string" && incoming.projectDir
      && canonicalDir(incoming.projectDir) !== canonicalDir(dir)) {
      // Another project's write: nothing to patch here, and it is no reason to
      // refetch the current project.
      return true
    }
    // Same reset refresh() does on a project switch, so a stray event can never
    // graft records onto the wrong project. Bump the refresh generation too: an
    // in-flight refresh for the previous project must not land after this reset.
    if (dataDir !== dir) {
      dataDir = dir
      seq += 1
      setItems([])
      setRecords([])
      setLoaded(false)
      setRevision((value) => value + 1)
    }
    const existing = records().find((entry) => entry.id === incoming.id)
    const incomingAt = Date.parse(incoming.updatedAt)
    const existingAt = existing ? Date.parse(existing.updatedAt) : Number.NaN
    // Stale event (a newer list snapshot already landed): handled, no writes.
    if (existing && Number.isFinite(existingAt) && incomingAt < existingAt) return true
    // Same revision: keep object identity so memoized views do not thrash.
    if (existing && incomingAt === existingAt) {
      if (patchAttention(incoming)) setRevision((value) => value + 1)
      return true
    }
    if (existing) {
      setRecords((previous) => previous.map((entry) => (entry.id === incoming.id ? incoming : entry)))
    } else {
      setRecords((previous) => [...previous, incoming].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    }
    patchAttention(incoming)
    setRevision((value) => value + 1)
    return true
  }

  /** Patch attention rows that project the same id and expose status/summary. */
  function patchAttention(record: DecisionRecord): boolean {
    let changed = false
    setItems((previous) => {
      const index = previous.findIndex((item) => item.id === record.id)
      if (index < 0) return previous
      const item = previous[index] as AttentionPatchable
      const patch: Partial<AttentionPatchable> = {}
      if ("status" in item) patch.status = record.status
      if ("summary" in item) {
        patch.summary = record.rationale ?? record.consequences ?? record.question
      }
      if (Object.keys(patch).length === 0) return previous
      changed = true
      const next = previous.slice()
      next[index] = { ...item, ...patch }
      return next
    })
    return changed
  }

  async function refresh(): Promise<void> {
    const dir = deps.projectDir()
    if (!dir) return
    const my = ++seq
    if (dataDir !== dir) {
      dataDir = dir
      setItems([])
      setRecords([])
      setLoaded(false)
      setRevision((value) => value + 1)
    }
    const attentionTask = deps.api.attention(dir)
      .then((next) => {
        if (my !== seq || deps.projectDir() !== dir) return
        setItems(Array.isArray(next?.items) ? next.items : [])
        setLoaded(true)
        setRevision((value) => value + 1)
      })
      .catch(() => { /* fail-open: keep the last projected list for this project */ })
    const recordsTask = deps.api.decisions
      ? deps.api.decisions(dir)
        .then((next) => {
          if (my !== seq || deps.projectDir() !== dir) return
          const nextItems = Array.isArray(next?.items) ? next.items : []
          setRecords((previous) => {
            const byId = new Map(previous.map((record) => [record.id, record]))
            return nextItems.map((record) => {
              const old = byId.get(record.id)
              if (!old) return record
              const oldAt = Date.parse(old.updatedAt)
              const nextAt = Date.parse(record.updatedAt)
              // Freshness guard: a record ingested while this refresh was in
              // flight must survive an older snapshot. Equal updatedAt reuses
              // the stored object by design (memoized views must not thrash).
              if (Number.isFinite(oldAt) && Number.isFinite(nextAt)) return oldAt >= nextAt ? old : record
              return old.updatedAt >= record.updatedAt ? old : record
            })
          })
        })
        .catch(() => { /* fail-open: keep the last records for this project */ })
      : Promise.resolve()
    await Promise.all([attentionTask, recordsTask])
  }

  const currentDir = (): string => {
    const dir = deps.projectDir()
    if (!dir) throw new Error("no current project")
    return dir
  }

  async function confirm(
    id: string,
    input: { rationale: string; consequences: string; reviewAt?: string },
  ): Promise<void> {
    if (!deps.api.confirm) throw new Error("decision confirmation is unavailable")
    await deps.api.confirm(id, { projectDir: currentDir(), ...input })
    await refresh()
  }

  async function shelve(
    id: string,
    input: { reviewAt: string; note?: string },
  ): Promise<void> {
    if (!deps.api.shelve) throw new Error("decision shelving is unavailable")
    await deps.api.shelve(id, { projectDir: currentDir(), ...input })
    await refresh()
  }

  async function reopen(id: string): Promise<void> {
    if (!deps.api.reopen) throw new Error("decision reopening is unavailable")
    await deps.api.reopen(id, { projectDir: currentDir() })
    await refresh()
  }

  return { items, records, revision, loaded, refresh, ingest, board, counts, confirm, shelve, reopen }
}

export type DecisionStore = ReturnType<typeof createDecisionStore>
