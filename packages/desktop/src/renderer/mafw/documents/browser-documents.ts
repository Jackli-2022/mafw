// Web 文档状态：document 层拥有浏览器 tab 集合与 active id。
// browser-tabs.ts 保留为兼容 facade，供 BrowserDock / persistence / tests 继续使用旧命名。
import { createSignal } from "solid-js"
import { displayMafwFilePath } from "../../../shared/mafw-file"

export type BrowserDocument = {
  id: string
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
  failed?: string
}

export const BROWSER_TAB_LIMIT = 12

let seq = 0

function reserveBrowserDocumentSeq(id: string): void {
  const match = /^browser-tab-(\d+)$/.exec(id)
  if (match) seq = Math.max(seq, Number(match[1]))
}

export function createBrowserDocument(url: string, id: string, title = ""): BrowserDocument {
  return { id, url, title, loading: false, canBack: false, canForward: false }
}

export function browserDocumentTitle(tab: BrowserDocument): string {
  const titled = tab.title.trim()
  if (titled) return titled
  const localPath = displayMafwFilePath(tab.url)
  if (localPath) {
    return localPath.split(/[\\/]/).filter(Boolean).pop() || "新标签页"
  }
  try {
    return new URL(tab.url).host || "新标签页"
  } catch {
    return "新标签页"
  }
}

/** Closing tab: non-active close keeps active; active close goes left, then right. */
export function nextBrowserDocumentAfterClose(
  tabs: BrowserDocument[],
  activeId: string | null,
  closingId: string,
): string | null {
  if (activeId !== closingId) return activeId
  const index = tabs.findIndex((tab) => tab.id === closingId)
  if (index < 0) return activeId
  return tabs[index - 1]?.id ?? tabs[index + 1]?.id ?? null
}

const [documents, setDocuments] = createSignal<BrowserDocument[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)

export function browserDocuments(): BrowserDocument[] {
  return documents()
}

export function activeBrowserDocumentId(): string | null {
  return activeId()
}

export function setActiveBrowserDocument(id: string): void {
  if (documents().some((tab) => tab.id === id)) setActiveId(id)
}

export type OpenBrowserDocumentOpts = {
  newTab?: boolean
  id?: string
  title?: string
}

/** Open/update a tab. Returns null when the 12-tab cap is hit. */
export function openBrowserDocument(
  url: string,
  opts: OpenBrowserDocumentOpts = {},
): BrowserDocument | null {
  const newTab = opts.newTab ?? true
  const current = documents()
  if (newTab || !activeId() || !current.some((tab) => tab.id === activeId())) {
    if (current.length >= BROWSER_TAB_LIMIT) return null
    const tab = createBrowserDocument(url, opts.id ?? `browser-tab-${++seq}`, opts.title)
    if (opts.id) reserveBrowserDocumentSeq(tab.id)
    setDocuments([...current, tab])
    setActiveId(tab.id)
    return tab
  }
  const id = activeId()!
  setDocuments(current.map((tab) => (tab.id === id ? { ...tab, url, title: opts.title ?? "", failed: undefined } : tab)))
  return documents().find((tab) => tab.id === id) ?? null
}

export function closeBrowserDocument(id: string): void {
  const current = documents()
  if (!current.some((tab) => tab.id === id)) return
  const next = nextBrowserDocumentAfterClose(current, activeId(), id)
  setDocuments(current.filter((tab) => tab.id !== id))
  setActiveId(next)
}

/** Context-menu action: keep only [id] and make it active. */
export function closeOtherBrowserDocuments(id: string): void {
  const current = documents()
  const keep = current.find((tab) => tab.id === id)
  if (!keep) return
  setDocuments([keep])
  setActiveId(keep.id)
}

/** Context-menu action: keep [id] and everything left of it. */
export function closeBrowserDocumentsToRight(id: string): void {
  const current = documents()
  const index = current.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const keep = current.slice(0, index + 1)
  setDocuments(keep)
  if (!keep.some((tab) => tab.id === activeId())) {
    setActiveId(keep[keep.length - 1]?.id ?? null)
  }
}

export function updateBrowserDocument(id: string, patch: Partial<BrowserDocument>): void {
  setDocuments((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))
}

export function resetBrowserDocumentsForTests(): void {
  seq = 0
  setDocuments([])
  setActiveId(null)
}
