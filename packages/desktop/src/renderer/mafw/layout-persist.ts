// Session-tab layout persistence across restarts. Split-view TREES are
// intentionally not persisted (they reference pane paths); only the flat
// session tab list + active view survive, pruned against sessions that still
// exist on load. Storage is injected so the logic is testable.
export const LAYOUT_KEY = "mafw.layout.v1"
export const LAYOUTS_KEY = "mafw.layout.v2"

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

// ── Per-project layouts (v2) ───────────────────────────────────────────────
// One window can hold sessions from several projects; switching projects must
// restore that project's own tab strip instead of leaving foreign tabs behind.

export type ProjectLayouts = Record<string, LayoutSnapshot>

function normalizeSnapshot(parsed: any): LayoutSnapshot | null {
  if (!parsed || !Array.isArray(parsed.tabs)) return null
  const tabs = parsed.tabs.filter((t: any) => typeof t?.id === "string" && t.id)
  if (tabs.length === 0) return null
  return {
    tabs,
    activeViewId: typeof parsed.activeViewId === "string" ? parsed.activeViewId : null,
    savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : undefined,
  }
}

export function loadProjectLayouts(io: LayoutIO): ProjectLayouts {
  try {
    const raw = io.getItem(LAYOUTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: ProjectLayouts = {}
    for (const [project, value] of Object.entries(parsed)) {
      if (!project) continue
      const snap = normalizeSnapshot(value)
      if (snap) out[project] = snap
    }
    return out
  } catch {
    return {}
  }
}

/** Save one project's tabs; an empty tab list removes only that project. */
export function saveProjectLayout(
  io: LayoutIO,
  project: string,
  snap: Omit<LayoutSnapshot, "savedAt">,
): boolean {
  if (!project) return false
  try {
    const all = loadProjectLayouts(io)
    if (snap.tabs.length === 0) {
      delete all[project]
    } else {
      all[project] = { ...snap, savedAt: Date.now() }
    }
    if (Object.keys(all).length === 0) io.removeItem(LAYOUTS_KEY)
    else io.setItem(LAYOUTS_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

export function loadProjectLayout(io: LayoutIO, project: string): LayoutSnapshot | null {
  if (!project) return null
  return loadProjectLayouts(io)[project] ?? null
}

/**
 * v1 stored one global tab set. Migrate it to the first project that opens,
 * then remove the legacy key so a second project does not inherit it.
 */
export function migrateLegacyLayout(io: LayoutIO, project: string): LayoutSnapshot | null {
  if (!project) return null
  const existing = loadProjectLayout(io, project)
  if (existing) return existing
  const legacy = loadLayout(io)
  if (!legacy) return null
  const ok = saveProjectLayout(io, project, { tabs: legacy.tabs, activeViewId: legacy.activeViewId })
  if (ok) {
    try { io.removeItem(LAYOUT_KEY) } catch { /* fail-open */ }
  }
  return loadProjectLayout(io, project)
}
