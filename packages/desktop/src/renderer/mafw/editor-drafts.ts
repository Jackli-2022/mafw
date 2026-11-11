// editor-drafts：跨组件 root-scoped 草稿/磁盘基准存储（模块单例）。
//
// 为什么不是组件内 Map：RightDock 关闭（presence 卸载）或 connDown 替换面板时
// 组件会卸载，草稿必须存活；key 带 root 保证不同项目/worktree 的同名文件
// 绝不串内容（终审 Important 2/8）。
//
// D3d：草稿同时写穿到 localStorage（按 root 隔离、300ms 去抖），重启后
// 重新打开同一文件仍能取回未保存内容；磁盘基准/EOL 一并恢复。
export type Eol = "\n" | "\r\n"

export type EditorDraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const drafts = new Map<string, string>()
const mtimes = new Map<string, number>()
const eols = new Map<string, Eol>()

const PREFIX = "mafw-editor-drafts:"
const PERSIST_DELAY_MS = 300
const loadedRoots = new Set<string>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
function defaultStorage(): EditorDraftStorage | null {
  try {
    const local = (globalThis as { localStorage?: EditorDraftStorage }).localStorage
    return local ?? null
  } catch {
    return null
  }
}
let storage: EditorDraftStorage | null = defaultStorage()

const key = (root: string, rel: string) => `${root}\u0000${rel}`
const normalizeRoot = (root: string) => root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
const storageKey = (root: string) => `${PREFIX}${normalizeRoot(root)}`

function loadRoot(root: string): void {
  if (loadedRoots.has(root) || !storage) return
  loadedRoots.add(root)
  try {
    const raw = storage.getItem(storageKey(root))
    if (!raw) return
    const parsed = JSON.parse(raw) as {
      drafts?: Record<string, string>
      mtimes?: Record<string, number>
      eols?: Record<string, Eol>
    }
    for (const [rel, content] of Object.entries(parsed.drafts ?? {})) {
      if (typeof content === "string") drafts.set(key(root, rel), content)
    }
    for (const [rel, value] of Object.entries(parsed.mtimes ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) mtimes.set(key(root, rel), value)
    }
    for (const [rel, value] of Object.entries(parsed.eols ?? {})) {
      if (value === "\n" || value === "\r\n") eols.set(key(root, rel), value)
    }
  } catch { /* blocked/corrupt — fail-open */ }
}

function persistNow(root: string): void {
  if (!storage) return
  const prefix = `${root}\u0000`
  const payload = {
    drafts: {} as Record<string, string>,
    mtimes: {} as Record<string, number>,
    eols: {} as Record<string, Eol>,
  }
  for (const [k, value] of drafts) {
    if (k.startsWith(prefix)) payload.drafts[k.slice(prefix.length)] = value
  }
  for (const [k, value] of mtimes) {
    if (k.startsWith(prefix)) payload.mtimes[k.slice(prefix.length)] = value
  }
  for (const [k, value] of eols) {
    if (k.startsWith(prefix)) payload.eols[k.slice(prefix.length)] = value
  }
  try {
    if (!payload.drafts || Object.keys(payload.drafts).length === 0) {
      storage.removeItem?.(storageKey(root))
      if (!storage.removeItem) storage.setItem(storageKey(root), JSON.stringify({ drafts: {}, mtimes: {}, eols: {} }))
      return
    }
    storage.setItem(storageKey(root), JSON.stringify(payload))
  } catch { /* quota/blocked — fail-open */ }
}

function schedule(root: string): void {
  if (!storage) return
  const previous = persistTimers.get(root)
  if (previous) clearTimeout(previous)
  const timer = setTimeout(() => {
    persistTimers.delete(root)
    persistNow(root)
  }, PERSIST_DELAY_MS)
  ;(timer as any).unref?.()
  persistTimers.set(root, timer)
}

export function configureEditorDraftStorage(next: EditorDraftStorage | null): void {
  storage = next
  loadedRoots.clear()
}

/** 立即落盘（测试 / 卸载 / 关键动作后）。 */
export function flushEditorDrafts(root?: string): void {
  if (root) {
    const timer = persistTimers.get(root)
    if (timer) clearTimeout(timer)
    persistTimers.delete(root)
    persistNow(root)
    return
  }
  for (const [key, timer] of [...persistTimers]) {
    clearTimeout(timer)
    persistTimers.delete(key)
    persistNow(key)
  }
}

export function setDraft(root: string, rel: string, content: string): void {
  loadRoot(root)
  drafts.set(key(root, rel), content)
  schedule(root)
}
export function getDraft(root: string, rel: string): string | undefined {
  loadRoot(root)
  return drafts.get(key(root, rel))
}
export function clearDraft(root: string, rel: string): void {
  loadRoot(root)
  drafts.delete(key(root, rel))
  schedule(root)
}
export function setMtime(root: string, rel: string, mtimeMs: number): void {
  loadRoot(root)
  mtimes.set(key(root, rel), mtimeMs)
  schedule(root)
}
export function getMtime(root: string, rel: string): number | undefined {
  loadRoot(root)
  return mtimes.get(key(root, rel))
}
export function setEol(root: string, rel: string, eol: Eol): void {
  loadRoot(root)
  eols.set(key(root, rel), eol)
  schedule(root)
}
export function getEol(root: string, rel: string): Eol | undefined {
  loadRoot(root)
  return eols.get(key(root, rel))
}

/** 清某 root 的全部草稿/基准（项目关闭等）。 */
export function clearRoot(root: string): void {
  const prefix = `${root}\u0000`
  for (const k of [...drafts.keys()]) if (k.startsWith(prefix)) drafts.delete(k)
  for (const k of [...mtimes.keys()]) if (k.startsWith(prefix)) mtimes.delete(k)
  for (const k of [...eols.keys()]) if (k.startsWith(prefix)) eols.delete(k)
  const timer = persistTimers.get(root)
  if (timer) clearTimeout(timer)
  persistTimers.delete(root)
  try { storage?.removeItem?.(storageKey(root)) } catch { /* ignore */ }
}

/** 测试用。 */
export function clearAllDrafts(): void {
  for (const timer of persistTimers.values()) clearTimeout(timer)
  persistTimers.clear()
  drafts.clear()
  mtimes.clear()
  eols.clear()
  loadedRoots.clear()
}
