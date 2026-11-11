// 每个内容 scope 的恢复状态：树展开/选中、编辑器 tabs/活动文件、阅读位置、选区。
// 模块单例只在 renderer 内使用；scopeKey 由 contentScopeKey 生成。
export type EditorSelectionRange = {
  anchor: number
  head: number
}

export type ContentScopeState = {
  treeExpanded: string[]
  treeSelected: string | null
  openFiles: string[]
  activeFile: string | null
  readingPositions: Record<string, number>
  selections: Record<string, EditorSelectionRange>
  /** 窄容器下文件树抽屉的用户偏好；按 scope 恢复。 */
  filesOpen: boolean
}

export type ContentScopeStateStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export type ContentScopeStateListener = (scopeKey: string, state: ContentScopeState) => void

const states = new Map<string, ContentScopeState>()
const listeners = new Set<ContentScopeStateListener>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
function defaultStorage(): ContentScopeStateStorage | null {
  try {
    const local = (globalThis as { localStorage?: ContentScopeStateStorage }).localStorage
    return local ?? null
  } catch {
    return null
  }
}
let storage: ContentScopeStateStorage | null = defaultStorage()
const PERSIST_DELAY_MS = 300
const STORAGE_PREFIX = "mafw-content-state:"

function storageKey(scopeKey: string): string {
  return `${STORAGE_PREFIX}${scopeKey}`
}

function parseState(raw: string | null): ContentScopeState | null {
  if (!raw) return null
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const positions: Record<string, number> = {}
  if (parsed.readingPositions && typeof parsed.readingPositions === "object") {
    for (const [key, value] of Object.entries(parsed.readingPositions)) {
      if (typeof value === "number" && Number.isFinite(value)) positions[key] = value
    }
  }
  const selections: Record<string, EditorSelectionRange> = {}
  if (parsed.selections && typeof parsed.selections === "object") {
    for (const [key, value] of Object.entries(parsed.selections)) {
      const range = value as any
      if (range && typeof range.anchor === "number" && typeof range.head === "number") {
        selections[key] = { anchor: range.anchor, head: range.head }
      }
    }
  }
  return {
    treeExpanded: Array.isArray(parsed.treeExpanded) ? parsed.treeExpanded.filter((item: unknown) => typeof item === "string") : [],
    treeSelected: typeof parsed.treeSelected === "string" ? parsed.treeSelected : null,
    openFiles: Array.isArray(parsed.openFiles) ? parsed.openFiles.filter((item: unknown) => typeof item === "string") : [],
    activeFile: typeof parsed.activeFile === "string" ? parsed.activeFile : null,
    readingPositions: positions,
    selections,
    filesOpen: parsed.filesOpen === true,
  }
}

function loadPersisted(scopeKey: string): void {
  if (states.has(scopeKey) || !storage) return
  try {
    const restored = parseState(storage.getItem(storageKey(scopeKey)))
    if (restored) states.set(scopeKey, restored)
  } catch { /* storage blocked — keep empty */ }
}

function persistNow(scopeKey: string): void {
  if (!storage) return
  const state = states.get(scopeKey)
  if (!state) return
  try {
    storage.setItem(storageKey(scopeKey), JSON.stringify(state))
  } catch { /* quota/blocked — fail-open */ }
}

function schedulePersist(scopeKey: string): void {
  if (!storage) return
  const previous = persistTimers.get(scopeKey)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    persistTimers.delete(scopeKey)
    persistNow(scopeKey)
  }, PERSIST_DELAY_MS)
  ;(timer as any).unref?.()
  persistTimers.set(scopeKey, timer)
}

/** renderer 启动时注入 localStorage；测试可注入 fake。 */
export function configureContentScopeStateStorage(next: ContentScopeStateStorage | null): void {
  storage = next
}

/** 立即落盘（测试 / 卸载 / 关键动作后）。 */
export function flushContentScopeStatePersistence(scopeKey?: string | null): void {
  if (scopeKey) {
    const timer = persistTimers.get(scopeKey)
    if (timer) clearTimeout(timer)
    persistTimers.delete(scopeKey)
    persistNow(scopeKey)
    return
  }
  for (const [key, timer] of [...persistTimers]) {
    clearTimeout(timer)
    persistTimers.delete(key)
    persistNow(key)
  }
}

export function emptyContentScopeState(): ContentScopeState {
  return {
    treeExpanded: [],
    treeSelected: null,
    openFiles: [],
    activeFile: null,
    readingPositions: {},
    selections: {},
    filesOpen: false,
  }
}

function clone(state: ContentScopeState): ContentScopeState {
  return {
    treeExpanded: [...state.treeExpanded],
    treeSelected: state.treeSelected,
    openFiles: [...state.openFiles],
    activeFile: state.activeFile,
    readingPositions: { ...state.readingPositions },
    selections: { ...(state.selections ?? {}) },
    filesOpen: state.filesOpen === true,
  }
}

export function contentScopeStateFor(scopeKey: string | null): ContentScopeState {
  if (!scopeKey) return emptyContentScopeState()
  loadPersisted(scopeKey)
  const state = states.get(scopeKey)
  return state ? clone(state) : emptyContentScopeState()
}

export function saveContentScopeState(scopeKey: string | null, state: ContentScopeState): void {
  if (!scopeKey) return
  states.set(scopeKey, clone(state))
  schedulePersist(scopeKey)
  for (const listener of [...listeners]) listener(scopeKey, clone(state))
}

/** 外部状态写入（返回/标签切换）后让挂载中的面板同步，无需整树重载。 */
export function onContentScopeStateChange(listener: ContentScopeStateListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function updateContentScopeState(
  scopeKey: string | null,
  update: (state: ContentScopeState) => ContentScopeState,
): ContentScopeState {
  const next = update(contentScopeStateFor(scopeKey))
  saveContentScopeState(scopeKey, next)
  return next
}

export function setTreeExpanded(
  state: ContentScopeState,
  rel: string,
  expanded: boolean,
): ContentScopeState {
  const has = state.treeExpanded.includes(rel)
  if (has === expanded) return state
  return {
    ...state,
    treeExpanded: expanded
      ? [...state.treeExpanded, rel]
      : state.treeExpanded.filter((item) => item !== rel),
  }
}

export function toggleTreeExpanded(state: ContentScopeState, rel: string): ContentScopeState {
  return setTreeExpanded(state, rel, !state.treeExpanded.includes(rel))
}

export function selectTreeFile(
  state: ContentScopeState,
  rel: string | null,
): ContentScopeState {
  if (state.treeSelected === rel) return state
  return { ...state, treeSelected: rel }
}

export function rememberOpenFile(state: ContentScopeState, rel: string): ContentScopeState {
  if (state.openFiles.includes(rel)) return state
  return { ...state, openFiles: [...state.openFiles, rel] }
}

export function rememberActiveFile(state: ContentScopeState, rel: string): ContentScopeState {
  const withFile = rememberOpenFile(state, rel)
  return withFile.activeFile === rel ? withFile : { ...withFile, activeFile: rel }
}

export function rememberReadingPosition(
  state: ContentScopeState,
  rel: string,
  scrollTop: number,
): ContentScopeState {
  const top = Number.isFinite(scrollTop) ? Math.max(0, Math.round(scrollTop)) : 0
  if (state.readingPositions[rel] === top) return state
  return { ...state, readingPositions: { ...state.readingPositions, [rel]: top } }
}

export function readingPositionFor(state: ContentScopeState, rel: string): number | null {
  return Object.prototype.hasOwnProperty.call(state.readingPositions, rel)
    ? state.readingPositions[rel]
    : null
}

function clampOffset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function rememberSelection(
  state: ContentScopeState,
  rel: string,
  selection: EditorSelectionRange | null,
): ContentScopeState {
  if (!selection) {
    if (!state.selections[rel]) return state
    const next = { ...state.selections }
    delete next[rel]
    return { ...state, selections: next }
  }
  const next = { anchor: clampOffset(selection.anchor), head: clampOffset(selection.head) }
  const prev = state.selections[rel]
  if (prev && prev.anchor === next.anchor && prev.head === next.head) return state
  return { ...state, selections: { ...state.selections, [rel]: next } }
}

export function selectionFor(
  state: ContentScopeState,
  rel: string,
): EditorSelectionRange | null {
  const selection = state.selections[rel]
  return selection ? { ...selection } : null
}

export function clearContentScopeStates(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer)
  persistTimers.clear()
  states.clear()
  listeners.clear()
}
