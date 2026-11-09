// Task 7: pure projection of plugin Web surfaces and left-rail entries.
//
// Inputs are committed `PluginClientDescriptor`s; outputs are plain data for
// Solid components. No Solid, DOM, Electron or Node built-ins are imported, so
// surface identity, defaults, ordering and the sandboxed page URL are testable
// headlessly (spec 2026-11-09 §6.1/§6.4).
//
// Old-gateway tolerance: `ui.webSurfaces` is read defensively. A descriptor
// validated by an older gateway (or a fixture written before projection) may
// omit `entry`/`scope`/`reloadOnSessionChange`, and packages without the slot
// must project to nothing rather than break the rail.
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import { pluginSurfaceId, type PluginSurfaceId } from "../workbench-views"
import type { PluginTabSurface } from "./plugin-view-model"

/** Declared rail projection (defaults already applied). */
export interface PluginWebSurfaceRailView {
  icon: string
  order: number
  badge: boolean
}

/** One workbench surface backed by a sandboxed plugin page. */
export interface PluginWebSurfaceView {
  packageName: string
  surfaceId: PluginSurfaceId
  id: string
  title: string
  icon?: string
  /** Entry file relative to the package `web/` directory. */
  entry: string
  scope: "session" | "project" | "global"
  reloadOnSessionChange: boolean
  rail?: PluginWebSurfaceRailView
  /** Committed descriptor revision; used as a cache-busting query token. */
  revision: string
}

/** Left-rail entry derived from a web surface. */
export interface PluginRailItem {
  surfaceId: PluginSurfaceId
  packageName: string
  label: string
  icon: string
  order: number
  badge: boolean
}

/**
 * Task 9: one web surface as an L2 workbench tab.
 *
 * `descriptor` is the owning package, exactly like a declarative panel tab, so
 * the tab strip can render both without a second code path.
 */
export interface PluginWebTab extends PluginTabSurface {
  view: PluginWebSurfaceView
}

/** Same character set as `workbench-views.ts` surface ids and the descriptor. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEFAULT_ENTRY = "index.html"
const DEFAULT_RAIL_ORDER = 100
const DEFAULT_SCOPE: PluginWebSurfaceView["scope"] = "session"

/**
 * Valid, ordered web surfaces.
 *
 * Ordering is the rail key (`order` ascending, default 100) with package name
 * and surface id as tie-breakers, so the L2 tab strip and the rail agree and a
 * snapshot refresh never reshuffles tabs. Surfaces with an invalid package
 * name/id are skipped (their persisted `plugin:` id would not parse) and a
 * duplicate `plugin:<pkg>:<id>` keeps the first declaration — one id has one
 * renderer.
 */
export function webSurfaceViews(
  plugins: readonly PluginClientDescriptor[],
): PluginWebSurfaceView[] {
  const views: PluginWebSurfaceView[] = []
  const seen = new Set<string>()
  for (const descriptor of plugins ?? []) {
    if (!descriptor || typeof descriptor !== "object") continue
    const packageName = typeof descriptor.name === "string" ? descriptor.name : ""
    if (!NAME_PATTERN.test(packageName)) continue
    const surfaces = descriptor.ui?.webSurfaces
    if (!Array.isArray(surfaces)) continue
    for (const surface of surfaces) {
      if (!surface || typeof surface !== "object") continue
      const id = typeof surface.id === "string" ? surface.id : ""
      if (!NAME_PATTERN.test(id)) continue
      const surfaceId = pluginSurfaceId(packageName, id)
      if (seen.has(surfaceId)) continue
      seen.add(surfaceId)

      const view: PluginWebSurfaceView = {
        packageName,
        surfaceId,
        id,
        title: nonEmpty(surface.title) ?? id,
        entry: nonEmpty(surface.entry) ?? DEFAULT_ENTRY,
        scope: isScope(surface.scope) ? surface.scope : DEFAULT_SCOPE,
        reloadOnSessionChange: surface.reloadOnSessionChange !== false,
        revision: typeof descriptor.revision === "string" ? descriptor.revision : "",
      }
      const icon = nonEmpty(surface.icon)
      if (icon) view.icon = icon
      const rail = surface.rail
      const railIcon = rail && typeof rail === "object" ? nonEmpty(rail.icon) : null
      if (rail && railIcon) {
        view.rail = {
          icon: railIcon,
          order: railOrder(rail.order),
          badge: rail.badge === true,
        }
      }
      views.push(view)
    }
  }
  views.sort(compareViews)
  return views
}

/**
 * Rail items for surfaces that declared `rail`, sorted the same way as views.
 *
 * Explicit sort (not just "views are already sorted") because the function is
 * a public contract for `IconRail` and callers may pass any view list.
 */
export function railItemsFromWebSurfaces(
  views: readonly PluginWebSurfaceView[],
): PluginRailItem[] {
  const items: PluginRailItem[] = []
  for (const view of views ?? []) {
    if (!view?.rail) continue
    items.push({
      surfaceId: view.surfaceId,
      packageName: view.packageName,
      label: view.title,
      icon: view.rail.icon,
      order: view.rail.order,
      badge: view.rail.badge,
    })
  }
  items.sort(compareRailItems)
  return items
}

/**
 * Task 9: L2 tab surfaces for web views.
 *
 * Views already carry the rail ordering (see `webSurfaceViews`), so the strip
 * and the rail agree; declarative panel/config tabs keep their own order ahead
 * of these. A view whose package descriptor is missing cannot happen with a
 * single projection source, but is skipped rather than rendered with a hole.
 */
export function webSurfaceTabs(
  views: readonly PluginWebSurfaceView[],
  plugins: readonly PluginClientDescriptor[],
): PluginWebTab[] {
  const byName = new Map<string, PluginClientDescriptor>()
  for (const descriptor of plugins ?? []) {
    if (descriptor && typeof descriptor.name === "string") byName.set(descriptor.name, descriptor)
  }
  const tabs: PluginWebTab[] = []
  for (const view of views ?? []) {
    const descriptor = byName.get(view.packageName)
    if (!descriptor) continue
    tabs.push({ id: view.surfaceId, label: view.title, descriptor, view })
  }
  return tabs
}

/**
 * `src` for the surface `<webview>`: gateway origin + package asset namespace
 * + entry, with the committed revision as a cache-busting token.
 *
 * Mirrors `pluginWebUrl` in `src/main/plugin-web-session.ts` (that module owns
 * Node built-ins and cannot be imported by the renderer). Dot/empty segments
 * are dropped rather than resolved: the gateway resolver rejects them, and the
 * URL must never be able to point outside `/api/plugins/<pkg>/ui/`.
 */
export function webSurfaceSrc(gatewayUrl: string, view: PluginWebSurfaceView): string {
  const base = typeof gatewayUrl === "string" ? gatewayUrl.replace(/\/+$/, "") : ""
  const segments = (nonEmpty(view.entry) ?? DEFAULT_ENTRY)
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .map((segment) => encodeURIComponent(segment))
  const path = segments.join("/") || DEFAULT_ENTRY
  const url = `${base}/api/plugins/${encodeURIComponent(view.packageName)}/ui/${path}`
  return view.revision ? `${url}?revision=${encodeURIComponent(view.revision)}` : url
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isScope(value: unknown): value is PluginWebSurfaceView["scope"] {
  return value === "session" || value === "project" || value === "global"
}

function railOrder(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_RAIL_ORDER
}

function viewOrder(view: PluginWebSurfaceView): number {
  return view.rail?.order ?? DEFAULT_RAIL_ORDER
}

function compareViews(a: PluginWebSurfaceView, b: PluginWebSurfaceView): number {
  const order = viewOrder(a) - viewOrder(b)
  if (order !== 0) return order
  if (a.packageName !== b.packageName) return a.packageName < b.packageName ? -1 : 1
  if (a.surfaceId === b.surfaceId) return 0
  return a.surfaceId < b.surfaceId ? -1 : 1
}

function compareRailItems(a: PluginRailItem, b: PluginRailItem): number {
  if (a.order !== b.order) return a.order - b.order
  if (a.packageName !== b.packageName) return a.packageName < b.packageName ? -1 : 1
  if (a.surfaceId === b.surfaceId) return 0
  return a.surfaceId < b.surfaceId ? -1 : 1
}
