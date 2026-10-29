// Workbench browser tabs: pure model + module-level store that survives
// BrowserDock unmount (right dock collapse) while webviews are recreated.
import { createSignal } from "solid-js"

export type BrowserTab = {
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

export function createBrowserTab(url: string, id: string, title = ""): BrowserTab {
  return { id, url, title, loading: false, canBack: false, canForward: false }
}

export function browserTabTitle(tab: BrowserTab): string {
  const titled = tab.title.trim()
  if (titled) return titled
  try {
    return new URL(tab.url).host || "新标签页"
  } catch {
    return "新标签页"
  }
}

/** Closing tab: non-active close keeps active; active close goes left, then right. */
export function nextBrowserTabAfterClose(
  tabs: BrowserTab[],
  activeId: string | null,
  closingId: string,
): string | null {
  if (activeId !== closingId) return activeId
  const index = tabs.findIndex((tab) => tab.id === closingId)
  if (index < 0) return activeId
  return tabs[index - 1]?.id ?? tabs[index + 1]?.id ?? null
}

const [tabs, setTabs] = createSignal<BrowserTab[]>([])
const [activeId, setActiveId] = createSignal<string | null>(null)

export function browserTabs(): BrowserTab[] {
  return tabs()
}

export function activeBrowserTabId(): string | null {
  return activeId()
}

export function setActiveBrowserTab(id: string): void {
  if (tabs().some((tab) => tab.id === id)) setActiveId(id)
}

export type OpenBrowserTabOpts = {
  newTab?: boolean
  id?: string
  title?: string
}

/** Open/update a tab. Returns null when the 12-tab cap is hit. */
export function openBrowserTab(url: string, opts: OpenBrowserTabOpts = {}): BrowserTab | null {
  const newTab = opts.newTab ?? true
  const current = tabs()
  if (newTab || !activeId() || !current.some((tab) => tab.id === activeId())) {
    if (current.length >= BROWSER_TAB_LIMIT) return null
    const tab = createBrowserTab(url, opts.id ?? `browser-tab-${++seq}`, opts.title)
    setTabs([...current, tab])
    setActiveId(tab.id)
    return tab
  }
  const id = activeId()!
  setTabs(current.map((tab) => (tab.id === id ? { ...tab, url, title: opts.title ?? "", failed: undefined } : tab)))
  return tabs().find((tab) => tab.id === id) ?? null
}

export function closeBrowserTab(id: string): void {
  const current = tabs()
  if (!current.some((tab) => tab.id === id)) return
  const next = nextBrowserTabAfterClose(current, activeId(), id)
  setTabs(current.filter((tab) => tab.id !== id))
  setActiveId(next)
}

export function updateBrowserTab(id: string, patch: Partial<BrowserTab>): void {
  setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))
}

export function resetBrowserTabsForTests(): void {
  seq = 0
  setTabs([])
  setActiveId(null)
}
