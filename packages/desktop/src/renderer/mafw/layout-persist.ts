// Session-tab layout persistence across restarts. Split-view TREES are
// intentionally not persisted (they reference pane paths); only the flat
// session tab list + active view survive, pruned against sessions that still
// exist on load. Storage is injected so the logic is testable.
export const LAYOUT_KEY = "mafw.layout.v1"

export type LayoutTab = { id: string; title?: string }
export type LayoutSnapshot = {
  tabs: LayoutTab[]
  activeViewId: string | null
  savedAt?: number
}

export type LayoutIO = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function saveLayout(io: LayoutIO, snap: Omit<LayoutSnapshot, "savedAt">): void {
  if (snap.tabs.length === 0) {
    io.removeItem(LAYOUT_KEY)
    return
  }
  try {
    io.setItem(LAYOUT_KEY, JSON.stringify({ ...snap, savedAt: Date.now() }))
  } catch { /* storage full/blocked — fail-open */ }
}

export function loadLayout(io: LayoutIO): LayoutSnapshot | null {
  try {
    const raw = io.getItem(LAYOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.tabs)) return null
    const tabs = parsed.tabs.filter((t: any) => typeof t?.id === "string" && t.id)
    if (tabs.length === 0) return null
    return {
      tabs,
      activeViewId: typeof parsed.activeViewId === "string" ? parsed.activeViewId : null,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : undefined,
    }
  } catch {
    return null
  }
}

/** Drop tabs whose sessions no longer exist; fix a dangling activeViewId. */
export function pruneMissing(snap: LayoutSnapshot, existing: Set<string>): LayoutSnapshot | null {
  const tabs = snap.tabs.filter(t => existing.has(t.id))
  if (tabs.length === 0) return null
  const activeViewId = snap.activeViewId && existing.has(snap.activeViewId) ? snap.activeViewId : tabs[0].id
  return { tabs, activeViewId, savedAt: snap.savedAt }
}
