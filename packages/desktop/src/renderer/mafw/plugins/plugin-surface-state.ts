// Task 9: runtime state the sandboxed page owns — badge count and title.
//
// The page calls `mafwPlugin.setBadge(n)` / `setTitle(t)` over the bridge; the
// host forwards them to the shell, which keeps them here so the left rail and
// the L2 tab strip read one source (spec 2026-11-09 §6.3). The declared title
// is always the fallback: an empty override means "the page has no opinion".
//
// Pure data (no Solid, no DOM): the shell wraps it in a signal and the wiring
// test runs headless. Every mutator returns the *same* object when nothing
// changed, so `setState(prev => apply(prev))` cannot churn signals or loop a
// `createEffect` that prunes on revision changes.
import type { PluginRailItem } from "./plugin-web-surface"

export interface PluginSurfaceRuntimeState {
  /** Surface id → non-zero count (absent = no badge). */
  badges: Record<string, number>
  /** Surface id → page-supplied label (absent = use the declared title). */
  titles: Record<string, string>
}

export const EMPTY_PLUGIN_SURFACE_RUNTIME: PluginSurfaceRuntimeState = Object.freeze({
  badges: {},
  titles: {},
})

/** Rail item plus the live count for surfaces that declared `rail.badge`. */
export interface PluginRailItemState extends PluginRailItem {
  count?: number
}

function normalizeId(surfaceId: unknown): string {
  return typeof surfaceId === "string" ? surfaceId.trim() : ""
}

function normalizeCount(count: unknown): number {
  const value = typeof count === "number" ? count : Number(count)
  if (!Number.isFinite(value)) return 0
  const floored = Math.floor(value)
  return floored > 0 ? floored : 0
}

/** Set/clear one badge. `0`, negative and non-finite counts remove the entry. */
export function applyPluginSurfaceBadge(
  state: PluginSurfaceRuntimeState,
  surfaceId: string,
  count: number,
): PluginSurfaceRuntimeState {
  const id = normalizeId(surfaceId)
  if (id.length === 0) return state
  const next = normalizeCount(count)
  if ((state.badges[id] ?? 0) === next) return state
  const badges = { ...state.badges }
  if (next === 0) delete badges[id]
  else badges[id] = next
  return { ...state, badges }
}

/** Set/clear one page title. An empty (or whitespace) title clears it. */
export function applyPluginSurfaceTitle(
  state: PluginSurfaceRuntimeState,
  surfaceId: string,
  title: string,
): PluginSurfaceRuntimeState {
  const id = normalizeId(surfaceId)
  if (id.length === 0) return state
  const next = typeof title === "string" ? title.trim() : ""
  if ((state.titles[id] ?? "") === next) return state
  const titles = { ...state.titles }
  if (next.length === 0) delete titles[id]
  else titles[id] = next
  return { ...state, titles }
}

/**
 * Drop badge/title state for surfaces a revision removed (or the package was
 * disabled). Live ids keep their state; nothing removed → same object.
 */
export function prunePluginSurfaceRuntime(
  state: PluginSurfaceRuntimeState,
  liveIds: readonly string[],
): PluginSurfaceRuntimeState {
  const live = new Set(liveIds)
  let changed = false
  const badges: Record<string, number> = {}
  for (const [id, count] of Object.entries(state.badges)) {
    if (live.has(id)) badges[id] = count
    else changed = true
  }
  const titles: Record<string, string> = {}
  for (const [id, title] of Object.entries(state.titles)) {
    if (live.has(id)) titles[id] = title
    else changed = true
  }
  return changed ? { badges, titles } : state
}

/** Page title for a surface, falling back to the declared one. */
export function pluginSurfaceTitle(
  state: PluginSurfaceRuntimeState,
  surfaceId: string,
  fallback: string,
): string {
  const id = normalizeId(surfaceId)
  const override = id.length > 0 ? state.titles[id] : undefined
  return override ?? fallback
}

/** Live badge count for a surface (0 when the page never set one). */
export function pluginSurfaceBadge(
  state: PluginSurfaceRuntimeState,
  surfaceId: string,
): number {
  const id = normalizeId(surfaceId)
  return (id.length > 0 ? state.badges[id] : undefined) ?? 0
}

/**
 * Rail items with the page title and the declared-badge count applied.
 *
 * `rail.badge: false` means "never show a count", even when the page publishes
 * one — the descriptor is the contract, the page only supplies the number.
 */
export function applyPluginRailState(
  items: readonly PluginRailItem[],
  state: PluginSurfaceRuntimeState,
): readonly PluginRailItemState[] {
  const hasTitles = Object.keys(state.titles).length > 0
  const hasBadges = Object.keys(state.badges).length > 0
  if (!hasTitles && !hasBadges) return items
  return items.map((item) => ({
    ...item,
    label: pluginSurfaceTitle(state, item.surfaceId, item.label),
    count: item.badge ? pluginSurfaceBadge(state, item.surfaceId) : 0,
  }))
}

/**
 * L2 tab surfaces with the page title applied.
 *
 * Returns the input array untouched when no tab was retitled, so the tab-strip
 * memo keeps its identity across unrelated revisions.
 */
export function applyPluginTabTitles<T extends { id: string; label: string }>(
  tabs: readonly T[],
  state: PluginSurfaceRuntimeState,
): readonly T[] {
  let changed = false
  const next = tabs.map((tab) => {
    const label = pluginSurfaceTitle(state, tab.id, tab.label)
    if (label === tab.label) return tab
    changed = true
    return { ...tab, label }
  })
  return changed ? next : tabs
}
