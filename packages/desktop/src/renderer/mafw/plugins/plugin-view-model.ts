// Task 8: pure view model for declarative plugin panels.
//
// Inputs are committed plugin descriptors and action responses; outputs are
// plain data for Solid components. No Solid, DOM, Electron or plugin code is
// imported here, so tab ordering, overflow, stale-response guards and action
// payload semantics are unit-testable headlessly.
import * as contractModule from "@mafw/plugin-contract"
import type {
  PluginClientDescriptor,
  PluginPanelDescriptor,
  PluginView,
} from "@mafw/plugin-contract"
import type { WorkbenchSurface } from "../workbench-views"
import { isPluginSurfaceId, pluginSurfaceId, type PluginSurfaceId } from "../workbench-views"
import type { PluginGeneration } from "./plugin-client"

// `@mafw/plugin-contract` is a CommonJS workspace package in Node tests but the
// renderer bundle aliases it to the ESM TypeScript source. Read through the
// synthetic default when present so both module shapes expose the same API.
const contract =
  (contractModule as unknown as { default?: typeof contractModule }).default ?? contractModule

export interface PluginSurface {
  id: PluginSurfaceId
  label: string
  panel: PluginPanelDescriptor
  descriptor: PluginClientDescriptor
}

export interface PluginSurfaceIssue {
  code: "panel-missing-action"
  level: "warning"
  package: string
  panel: string
  message: string
}

export interface PluginTabPlan {
  visible: PluginSurface[]
  overflow: PluginSurface[]
}

const ACTION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_LINK_PATTERN = /^(?:https?:|mailto:|tel:)/i
const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=._+-]+)*,/i

/**
 * Valid, ordered plugin panel surfaces.
 *
 * Stable sort: `order` (missing = 0), then label, then package name, then
 * panel id. Panels whose `viewAction` is empty or not declared by the package
 * are excluded — calling an undeclared action can only fail at the gateway.
 */
export function pluginSurfaces(
  descriptors: readonly PluginClientDescriptor[],
): PluginSurface[] {
  return collectSurfaces(descriptors).surfaces
}

/** Diagnostics produced while projecting panel surfaces (excluded panels). */
export function pluginSurfaceIssues(
  descriptors: readonly PluginClientDescriptor[],
): PluginSurfaceIssue[] {
  return collectSurfaces(descriptors).issues
}

export function planPluginTabs(
  surfaces: readonly PluginSurface[],
  options: { activeId?: string | null; capacity: number },
): PluginTabPlan {
  const capacity = Number.isFinite(options.capacity)
    ? Math.max(0, Math.floor(options.capacity))
    : 0
  if (surfaces.length <= capacity) {
    return { visible: [...surfaces], overflow: [] }
  }

  const visible = surfaces.slice(0, capacity)
  const overflow = surfaces.slice(capacity)
  const activeIndex = options.activeId
    ? overflow.findIndex((surface) => surface.id === options.activeId)
    : -1
  // Never hide the surface the user is looking at: swap it into the last
  // visible slot and let the displaced tab join the overflow menu.
  if (activeIndex >= 0 && capacity > 0) {
    const active = overflow[activeIndex] as PluginSurface
    const displaced = visible[capacity - 1] as PluginSurface
    visible[capacity - 1] = active
    overflow[activeIndex] = displaced
  }
  return { visible, overflow }
}

/**
 * Removed panel fallback.
 *
 * A persisted plugin surface is kept while the client snapshot has not loaded
 * yet (boot race); once descriptors are known and the panel is gone, the
 * workbench falls back to the built-in `code` surface.
 */
export function resolveActiveSurface(
  surface: WorkbenchSurface,
  pluginSurfaceIds: readonly string[],
  snapshotLoaded: boolean,
): WorkbenchSurface {
  if (!isPluginSurfaceId(surface)) return surface
  if (!snapshotLoaded) return surface
  return pluginSurfaceIds.includes(surface) ? surface : "code"
}

/** Text form of a widget the renderer does not understand (never markup). */
export function widgetFallbackText(widget: unknown): string {
  if (typeof widget === "string") return widget
  if (widget === undefined || widget === null) return ""
  if (typeof widget === "object") {
    try {
      return JSON.stringify(widget) ?? String(widget)
    } catch {
      return String(widget)
    }
  }
  return String(widget)
}

/** Exact action/input pair emitted by an `action` widget. */
export function actionWidgetInvocation(
  widget: unknown,
): { action: string; input: unknown } | null {
  if (!widget || typeof widget !== "object" || Array.isArray(widget)) return null
  const record = widget as Record<string, unknown>
  if (record.type !== "action") return null
  if (typeof record.action !== "string" || !ACTION_NAME_PATTERN.test(record.action)) return null
  return { action: record.action, input: record.input }
}

/** Link widgets must not be able to smuggle `javascript:`/`data:` URLs. */
export function safePluginLinkHref(href: unknown): string | null {
  if (typeof href !== "string" || href.trim().length === 0) return null
  const trimmed = href.trim()
  return SAFE_LINK_PATTERN.test(trimmed) ? trimmed : null
}

/** Image widgets only accept inline raster data URLs. */
export function safePluginImageDataUrl(dataUrl: unknown): string | null {
  if (typeof dataUrl !== "string" || !IMAGE_DATA_URL_PATTERN.test(dataUrl)) return null
  return dataUrl
}

/** True only for an event the panel explicitly subscribed to. */
export function pluginPanelRefreshesOn(
  panel: PluginPanelDescriptor,
  packageName: string,
  eventType: string,
): boolean {
  if (typeof eventType !== "string" || !eventType.startsWith(`plugin:${packageName}:`)) return false
  return (panel.refreshOn ?? []).includes(eventType)
}

// ---------------------------------------------------------------------------
// Panel view request state machine
// ---------------------------------------------------------------------------

export type PluginPanelViewStatus = "idle" | "loading" | "ready" | "error"

export interface PluginPanelViewState {
  /** Monotonic request counter; stale responses carry an older id. */
  requestId: number
  status: PluginPanelViewStatus
  /** Last successfully normalized view (kept across errors). */
  view: PluginView | null
  error: string | null
  /** Non-view action output shown above the current view. */
  actionOutput: string | null
  /** Plugin generation captured when the latest request started. */
  generation: PluginGeneration | null
}

export const EMPTY_PLUGIN_PANEL_VIEW_STATE: PluginPanelViewState = Object.freeze({
  requestId: 0,
  status: "idle",
  view: null,
  error: null,
  actionOutput: null,
  generation: null,
})

export interface PluginPanelRequestToken {
  requestId: number
  generation: PluginGeneration
}

/** Start a request: bumps the id and captures the plugin generation. */
export function beginPanelViewRequest(
  state: PluginPanelViewState,
  generation: PluginGeneration,
): PluginPanelViewState {
  return {
    ...state,
    requestId: state.requestId + 1,
    status: "loading",
    error: null,
    generation,
  }
}

/** Token a caller must present when the awaited response arrives. */
export function panelRequestToken(
  state: PluginPanelViewState,
): PluginPanelRequestToken | null {
  if (!state.generation) return null
  return { requestId: state.requestId, generation: state.generation }
}

/**
 * True when the response still belongs to the latest request *and* the plugin
 * client did not move to another boot/revision meanwhile.
 */
export function panelRequestStillCurrent(
  state: PluginPanelViewState,
  token: PluginPanelRequestToken,
  currentGeneration: PluginGeneration | null | undefined,
): boolean {
  if (token.requestId !== state.requestId) return false
  if (!currentGeneration) return false
  return token.generation.bootId === currentGeneration.bootId
    && token.generation.counter === currentGeneration.counter
    && token.generation.revision === currentGeneration.revision
}

/** Apply a view response; invalid payloads keep the last good view. */
export function settlePanelView(
  state: PluginPanelViewState,
  requestId: number,
  raw: unknown,
): PluginPanelViewState {
  if (requestId !== state.requestId) return state
  const view = contract.normalizePluginView(raw)
  if (!view) {
    return { ...state, status: "error", error: "插件视图格式无效" }
  }
  return { ...state, status: "ready", view, error: null }
}

/** Request failure: keep the last good view, surface the message. */
export function failPanelView(
  state: PluginPanelViewState,
  requestId: number,
  message: string,
): PluginPanelViewState {
  if (requestId !== state.requestId) return state
  return { ...state, status: "error", error: message }
}

/**
 * Replace the view with one returned by an action widget.
 *
 * Also bumps the request id: a view returned directly by an action is newer
 * than any refresh fetch that may still be in flight, so those responses must
 * be discarded instead of overwriting it.
 */
export function replacePanelView(
  state: PluginPanelViewState,
  view: PluginView,
): PluginPanelViewState {
  return {
    ...state,
    requestId: state.requestId + 1,
    status: "ready",
    view,
    error: null,
    actionOutput: null,
  }
}

export function setPanelActionOutput(
  state: PluginPanelViewState,
  text: string | null,
): PluginPanelViewState {
  return { ...state, actionOutput: text }
}

export type PanelActionOutcome =
  | { kind: "view"; view: PluginView }
  | { kind: "result"; text: string }
  | { kind: "empty" }

/**
 * Action responses are either a new PluginView (replace), `undefined`/`null`
 * (refetch only), or arbitrary JSON (show as text, then refetch).
 */
export function classifyPanelActionOutput(raw: unknown): PanelActionOutcome {
  const view = contract.normalizePluginView(raw)
  if (view) return { kind: "view", view }
  if (raw === undefined || raw === null) return { kind: "empty" }
  return { kind: "result", text: actionResultText(raw) }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function collectSurfaces(descriptors: readonly PluginClientDescriptor[]): {
  surfaces: PluginSurface[]
  issues: PluginSurfaceIssue[]
} {
  const surfaces: PluginSurface[] = []
  const issues: PluginSurfaceIssue[] = []
  for (const descriptor of descriptors) {
    for (const panel of descriptor.ui?.panels ?? []) {
      const action = panel.viewAction
      const declared = ACTION_NAME_PATTERN.test(action ?? "")
        && (descriptor.actions ?? []).some((candidate) => candidate?.name === action)
      if (!declared) {
        issues.push({
          code: "panel-missing-action",
          level: "warning",
          package: descriptor.name,
          panel: panel.id,
          message: `panel "${panel.id}" of ${descriptor.name} references an undeclared view action`,
        })
        continue
      }
      surfaces.push({
        id: pluginSurfaceId(descriptor.name, panel.id),
        label: typeof panel.title === "string" && panel.title.length > 0 ? panel.title : panel.id,
        panel,
        descriptor,
      })
    }
  }
  surfaces.sort(compareSurfaces)
  return { surfaces, issues }
}

function compareSurfaces(a: PluginSurface, b: PluginSurface): number {
  const orderA = a.panel.order ?? 0
  const orderB = b.panel.order ?? 0
  if (orderA !== orderB) return orderA - orderB
  if (a.label !== b.label) return a.label < b.label ? -1 : 1
  if (a.descriptor.name !== b.descriptor.name) {
    return a.descriptor.name < b.descriptor.name ? -1 : 1
  }
  if (a.panel.id === b.panel.id) return 0
  return a.panel.id < b.panel.id ? -1 : 1
}

function actionResultText(raw: unknown): string {
  if (typeof raw === "string") return raw
  try {
    const json = JSON.stringify(raw, null, 2)
    return typeof json === "string" ? json : String(raw)
  } catch {
    return String(raw)
  }
}
