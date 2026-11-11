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
}

export type ContentScopeStateListener = (scopeKey: string, state: ContentScopeState) => void

const states = new Map<string, ContentScopeState>()
const listeners = new Set<ContentScopeStateListener>()

export function emptyContentScopeState(): ContentScopeState {
  return {
    treeExpanded: [],
    treeSelected: null,
    openFiles: [],
    activeFile: null,
    readingPositions: {},
    selections: {},
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
  }
}

export function contentScopeStateFor(scopeKey: string | null): ContentScopeState {
  if (!scopeKey) return emptyContentScopeState()
  const state = states.get(scopeKey)
  return state ? clone(state) : emptyContentScopeState()
}

export function saveContentScopeState(scopeKey: string | null, state: ContentScopeState): void {
  if (!scopeKey) return
  states.set(scopeKey, clone(state))
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
  states.clear()
  listeners.clear()
}
