// 浏览器 tab 的跨重启恢复：只存 id / url / title，webview 内容不持久化。
// 只恢复 navigationDecision(url) === "allow" 的 URL；300ms 去抖，fail-open。
import { navigationDecision } from "../../../shared/browser-policy"
import {
  BROWSER_TAB_LIMIT,
  browserDocuments,
  openBrowserDocument,
  setActiveBrowserDocument,
} from "./browser-documents"
import type { DocumentListStorage } from "./document-list-persistence"

export type PersistedBrowserTab = {
  id: string
  url: string
  title?: string
}

export type BrowserTabsSnapshot = {
  version: 1
  activeId: string | null
  tabs: PersistedBrowserTab[]
}

const STORAGE_KEY = "mafw-browser-tabs:v1"
const PERSIST_DELAY_MS = 300
const MAX_TITLE = 200

function defaultStorage(): DocumentListStorage | null {
  try {
    return (globalThis as { localStorage?: DocumentListStorage }).localStorage ?? null
  } catch {
    return null
  }
}

let storage: DocumentListStorage | null = defaultStorage()
let pending: BrowserTabsSnapshot | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let restored = false

function emptySnapshot(): BrowserTabsSnapshot {
  return { version: 1, activeId: null, tabs: [] }
}

function normalizeTab(value: unknown): PersistedBrowserTab | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || raw.id.length === 0) return null
  if (typeof raw.url !== "string" || navigationDecision(raw.url) !== "allow") return null
  const title =
    typeof raw.title === "string" && raw.title.length > 0
      ? raw.title.slice(0, MAX_TITLE)
      : undefined
  return title ? { id: raw.id, url: raw.url, title } : { id: raw.id, url: raw.url }
}

function normalizeSnapshot(value: unknown): BrowserTabsSnapshot {
  if (!value || typeof value !== "object") return emptySnapshot()
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || !Array.isArray(raw.tabs)) return emptySnapshot()

  const seen = new Set<string>()
  const tabs: PersistedBrowserTab[] = []
  for (const item of raw.tabs) {
    const tab = normalizeTab(item)
    if (!tab || seen.has(tab.id)) continue
    seen.add(tab.id)
    tabs.push(tab)
    if (tabs.length >= BROWSER_TAB_LIMIT) break
  }
  const activeId =
    typeof raw.activeId === "string" && seen.has(raw.activeId) ? raw.activeId : null
  return { version: 1, activeId, tabs }
}

export function configureBrowserTabsStorage(next: DocumentListStorage | null): void {
  storage = next
}

export function loadBrowserTabsSnapshot(): BrowserTabsSnapshot {
  if (!storage) return emptySnapshot()
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return emptySnapshot()
    return normalizeSnapshot(JSON.parse(raw))
  } catch {
    return emptySnapshot()
  }
}

function writeSnapshot(snapshot: BrowserTabsSnapshot): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch { /* quota/blocked → fail-open */ }
}

export function saveBrowserTabsSnapshot(snapshot: BrowserTabsSnapshot): void {
  if (!storage) return
  pending = normalizeSnapshot(snapshot)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    const latest = pending
    pending = null
    if (latest) writeSnapshot(latest)
  }, PERSIST_DELAY_MS)
  ;(timer as any).unref?.()
}

export function flushBrowserTabsPersistence(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const latest = pending
  pending = null
  if (latest) writeSnapshot(latest)
}

/** 首次挂载调用；已存在的 id 不重复创建，恢复后清空快照的 active 选择。 */
export function restoreBrowserTabsOnce(): number {
  if (restored) return 0
  restored = true
  const snapshot = loadBrowserTabsSnapshot()
  if (snapshot.tabs.length === 0) return 0

  let count = 0
  const existing = new Set(browserDocuments().map((tab) => tab.id))
  for (const tab of snapshot.tabs) {
    if (existing.has(tab.id)) continue
    if (!openBrowserDocument(tab.url, { id: tab.id, title: tab.title, newTab: true })) break
    existing.add(tab.id)
    count++
  }
  if (snapshot.activeId && existing.has(snapshot.activeId)) {
    setActiveBrowserDocument(snapshot.activeId)
  }
  return count
}

export function resetBrowserTabsPersistenceForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
  restored = false
  storage = defaultStorage()
}
