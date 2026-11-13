// 按世界持久化工作台焦点栈。读取时逐条校验，坏数据静默丢弃；
// 写入 300ms 去抖，存储失败 fail-open。
import {
  subjectKey,
  type Focus,
  type Place,
  type Scope,
  type SubjectRef,
  type WorkbenchState,
  type WorldId,
} from "./focus-model"

export type FocusStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const PREFIX = "mafw-focus:v1:"
const PERSIST_DELAY_MS = 300
const MAX_STACK = 50
const MAX_KEPT = 20

function defaultStorage(): FocusStorage | null {
  try {
    return (globalThis as { localStorage?: FocusStorage }).localStorage ?? null
  } catch {
    return null
  }
}

let storage: FocusStorage | null = defaultStorage()
const states = new Map<WorldId, WorkbenchState>()
const timers = new Map<WorldId, ReturnType<typeof setTimeout>>()
const loaded = new Set<WorldId>()

function storageKey(worldId: WorldId): string {
  return `${PREFIX}${worldId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isScope(value: unknown): value is Scope {
  if (!isRecord(value)) return false
  if (value.kind === "world") {
    return typeof value.worldId === "string" && value.worldId.length > 0
  }
  if (value.kind === "goal") {
    return (
      typeof value.worldId === "string" &&
      value.worldId.length > 0 &&
      typeof value.goalId === "string" &&
      value.goalId.length > 0 &&
      typeof value.revision === "number" &&
      Number.isFinite(value.revision) &&
      typeof value.worktreeDir === "string" &&
      value.worktreeDir.length > 0
    )
  }
  return false
}

function isSubject(value: unknown): value is SubjectRef {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case "world":
      return true
    case "goal":
      return typeof value.goalId === "string" && value.goalId.length > 0
    case "file":
      return (
        typeof value.root === "string" &&
        value.root.length > 0 &&
        typeof value.rel === "string" &&
        value.rel.length > 0 &&
        (value.version === undefined || typeof value.version === "string")
      )
    case "web":
      return typeof value.url === "string" && value.url.length > 0
    case "terminal":
      return typeof value.id === "string" && value.id.length > 0
    case "plugin":
      return (
        typeof value.package === "string" &&
        value.package.length > 0 &&
        typeof value.panel === "string" &&
        value.panel.length > 0
      )
    default:
      return false
  }
}

function isPlace(value: unknown): value is Place {
  if (value === undefined) return true
  if (!isRecord(value)) return false
  if (value.scroll !== undefined && (typeof value.scroll !== "number" || !Number.isFinite(value.scroll))) return false
  if (value.filter !== undefined && typeof value.filter !== "string") return false
  if (value.selection !== undefined) {
    if (!isRecord(value.selection)) return false
    if (typeof value.selection.anchor !== "number" || !Number.isFinite(value.selection.anchor)) return false
    if (typeof value.selection.head !== "number" || !Number.isFinite(value.selection.head)) return false
  }
  return true
}

function isFocus(value: unknown): value is Focus {
  if (!isRecord(value)) return false
  if (!isScope(value.scope) || !isSubject(value.subject)) return false
  return isPlace(value.place)
}

function cloneSubject(subject: SubjectRef): SubjectRef {
  return { ...subject }
}

function cloneFocus(focus: Focus): Focus {
  return {
    scope: { ...focus.scope },
    subject: cloneSubject(focus.subject),
    place: {
      ...(focus.place.scroll !== undefined ? { scroll: focus.place.scroll } : {}),
      ...(focus.place.selection ? { selection: { ...focus.place.selection } } : {}),
      ...(focus.place.filter !== undefined ? { filter: focus.place.filter } : {}),
    },
  }
}

function cloneState(state: WorkbenchState): WorkbenchState {
  return {
    worldId: state.worldId,
    stack: state.stack.map(cloneFocus),
    kept: state.kept.map(cloneSubject),
  }
}

function dedupeSubjects(subjects: readonly SubjectRef[]): SubjectRef[] {
  const seen = new Set<string>()
  const out: SubjectRef[] = []
  for (const subject of subjects) {
    const key = subjectKey(subject)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cloneSubject(subject))
  }
  return out
}

function capState(state: WorkbenchState): WorkbenchState {
  return {
    worldId: state.worldId,
    stack: state.stack.filter((focus) => focus.subject.kind !== "diff").slice(-MAX_STACK).map(cloneFocus),
    kept: dedupeSubjects(state.kept).slice(0, MAX_KEPT),
  }
}

function parseState(raw: string | null): Omit<WorkbenchState, "worldId"> | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.v !== 1) return null
  if (!Array.isArray(parsed.stack) || !Array.isArray(parsed.kept)) return null
  return {
    stack: parsed.stack.filter(isFocus).slice(-MAX_STACK).map(cloneFocus),
    kept: dedupeSubjects(parsed.kept.filter(isSubject)).slice(0, MAX_KEPT),
  }
}

function schedule(worldId: WorldId): void {
  if (!storage) return
  const previous = timers.get(worldId)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    timers.delete(worldId)
    persistNow(worldId)
  }, PERSIST_DELAY_MS)
  ;(timer as any).unref?.()
  timers.set(worldId, timer)
}

function persistNow(worldId: WorldId): void {
  if (!storage) return
  const state = states.get(worldId)
  if (!state) return
  try {
    storage.setItem(storageKey(worldId), JSON.stringify({ v: 1, stack: state.stack, kept: state.kept }))
  } catch {
    /* quota / blocked — fail-open */
  }
}

export function configureFocusStorage(next: FocusStorage | null): void {
  storage = next
  loaded.clear()
}

export function loadFocusState(worldId: WorldId): WorkbenchState | null {
  if (!worldId) return null
  const existing = states.get(worldId)
  if (existing) return cloneState(existing)
  if (loaded.has(worldId)) return null
  loaded.add(worldId)
  if (!storage) return null
  try {
    const parsed = parseState(storage.getItem(storageKey(worldId)))
    if (!parsed) return null
    const state = capState({ worldId, ...parsed })
    states.set(worldId, state)
    return cloneState(state)
  } catch {
    return null
  }
}

export function saveFocusState(state: WorkbenchState): void {
  if (!state.worldId) return
  const capped = capState(state)
  states.set(state.worldId, capped)
  loaded.add(state.worldId)
  schedule(state.worldId)
}

export function flushFocusPersistence(worldId?: WorldId): void {
  if (worldId) {
    const timer = timers.get(worldId)
    if (timer) clearTimeout(timer)
    timers.delete(worldId)
    persistNow(worldId)
    return
  }
  for (const [id, timer] of [...timers]) {
    clearTimeout(timer)
    timers.delete(id)
  }
  for (const id of states.keys()) persistNow(id)
}

export function clearFocusPersistence(): void {
  if (storage?.removeItem) {
    for (const worldId of states.keys()) {
      try {
        storage.removeItem(storageKey(worldId))
      } catch {
        /* blocked — fail-open */
      }
    }
  }
  resetFocusPersistence()
}

/** 只清内存缓存与定时器，不碰存储；用于项目切换 / 测试重新加载。 */
export function resetFocusPersistence(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  states.clear()
  loaded.clear()
}
