// Task 11: main-window message windows.
//
// A message window is a controlled in-window overlay (never a BrowserWindow and
// never an OS-level always-on-top window). This module owns the pure lifecycle:
//
// - singleton identity `<package>:<declaration.id>`; a repeated trigger updates
//   the existing entry (and bumps `trigger`) instead of stacking a new one;
// - exact-trigger routing: only the declaration's own registered event opens a
//   window, and only when the package declares the referenced action;
// - modal focus ownership: `focus.modalKey` names the topmost modal (the host
//   traps/restores DOM focus), modeless windows never take focus;
// - revision cleanup: removed packages / declarations / trigger events close
//   their windows and release focus; compatible descriptor changes update the
//   entry so the renderer refetches;
// - stale-response guards for `viewAction` fetches (generation + window
//   identity), keeping the last good view on failure.
//
// No Solid, DOM, Electron or plugin code is imported here: the host component
// is a thin binding around these helpers.
import * as contractModule from "@mafw/plugin-contract"
import type {
  PluginClientDescriptor,
  PluginMessageWindowDescriptor,
  PluginView,
} from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"

// `@mafw/plugin-contract` is a CommonJS workspace package in Node tests but the
// renderer bundle aliases it to the ESM TypeScript source. Read through the
// synthetic default when present so both module shapes expose the same API.
const contract =
  (contractModule as unknown as { default?: typeof contractModule }).default ?? contractModule

const ACTION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface PluginWindowEventPayload {
  /** Exact registered package event type (`plugin:<package>:<event>`). */
  type: string
  properties?: unknown
  sessionID?: string
}

export interface PluginWindowEntry {
  /** Stable `<package>:<declaration.id>` singleton key. */
  key: string
  package: string
  id: string
  descriptor: PluginClientDescriptor
  declaration: PluginMessageWindowDescriptor
  /** Event payload of the latest trigger (passed to `viewAction`). */
  event: PluginWindowEventPayload
  /** Monotonic trigger counter; a repeated trigger bumps it (never stacks). */
  trigger: number
  modal: boolean
  dismissible: boolean
}

export interface PluginWindowFocusState {
  /** Topmost modal window that owns focus, or null when no modal is open. */
  modalKey: string | null
  /** Bumps whenever focus ownership changes (host re-applies/restores focus). */
  token: number
}

export interface PluginWindowState {
  windows: PluginWindowEntry[]
  focus: PluginWindowFocusState
}

const EMPTY_FOCUS: PluginWindowFocusState = Object.freeze({ modalKey: null, token: 0 })

export const EMPTY_PLUGIN_WINDOW_STATE: PluginWindowState = Object.freeze({
  windows: [],
  focus: EMPTY_FOCUS,
})

/** Singleton identity for a declared message window. */
export function pluginWindowKey(packageName: string, id: string): string {
  return `${packageName}:${id}`
}

/**
 * Declarations that Desktop may mount.
 *
 * Mirrors the contract guarantees defensively: an empty id/action, an action
 * the package does not declare, or a trigger the package did not register can
 * only fail at the gateway, so such windows are not projected at all.
 */
export function pluginWindowDeclarations(
  descriptor: PluginClientDescriptor,
): PluginMessageWindowDescriptor[] {
  if (!descriptor || typeof descriptor.name !== "string" || descriptor.name.length === 0) {
    return []
  }
  const actions = new Set(
    (descriptor.actions ?? []).map((action) => action?.name).filter((name): name is string => !!name),
  )
  const events = new Set(
    (descriptor.events ?? []).map((event) => event?.type).filter((type): type is string => !!type),
  )
  const prefix = `plugin:${descriptor.name}:`
  const windows = descriptor.ui?.messageWindows ?? []
  const out: PluginMessageWindowDescriptor[] = []
  for (const declaration of windows) {
    if (!declaration || typeof declaration !== "object") continue
    if (typeof declaration.id !== "string" || declaration.id.length === 0) continue
    if (typeof declaration.title !== "string") continue
    if (
      typeof declaration.viewAction !== "string" ||
      !ACTION_NAME_PATTERN.test(declaration.viewAction) ||
      !actions.has(declaration.viewAction)
    ) {
      continue
    }
    if (
      typeof declaration.triggerEvent !== "string" ||
      !declaration.triggerEvent.startsWith(prefix) ||
      !events.has(declaration.triggerEvent)
    ) {
      continue
    }
    out.push(declaration)
  }
  return out
}

/** True only for the declaration's exact registered event in the same package. */
export function pluginWindowTriggersOn(
  declaration: PluginMessageWindowDescriptor | null | undefined,
  packageName: string,
  eventType: string | null | undefined,
): boolean {
  if (!declaration || typeof eventType !== "string") return false
  if (typeof packageName !== "string" || packageName.length === 0) return false
  if (!eventType.startsWith(`plugin:${packageName}:`)) return false
  return eventType === declaration.triggerEvent
}

/** Neutral `viewAction` input: the raw window event payload. */
export function pluginWindowActionInput(event: PluginWindowEventPayload): {
  event: { type: string; properties: unknown }
  sessionID?: string
} {
  const payload: { event: { type: string; properties: unknown }; sessionID?: string } = {
    event: { type: event.type, properties: event.properties },
  }
  if (typeof event.sessionID === "string" && event.sessionID.length > 0) {
    payload.sessionID = event.sessionID
  }
  return payload
}

/** Identity used to discard responses for a superseded trigger/revision/action. */
export function pluginWindowIdentity(entry: PluginWindowEntry): string {
  return `${entry.key}#${entry.trigger}:${entry.declaration.viewAction}:${entry.descriptor.revision}`
}

/**
 * Open or update one message window.
 *
 * The trigger must be the declaration's exact registered event. A second
 * trigger for the same key replaces the entry in place (stable position,
 * `trigger + 1`) so the renderer refetches instead of stacking a duplicate.
 * Invalid input returns the previous state object untouched.
 */
export function openPluginWindow(
  state: PluginWindowState,
  input: {
    key?: string
    descriptor: PluginClientDescriptor
    declaration: PluginMessageWindowDescriptor
    event: PluginWindowEventPayload
  },
): PluginWindowState {
  const descriptor = input?.descriptor
  if (!descriptor || typeof descriptor.name !== "string" || descriptor.name.length === 0) {
    return state
  }
  const candidate = input.declaration
  if (!candidate || typeof candidate.id !== "string") return state
  const declaration = pluginWindowDeclarations(descriptor).find(
    (entry) => entry.id === candidate.id,
  )
  if (!declaration) return state

  const event = normalizeWindowEvent(input.event)
  if (!event || !pluginWindowTriggersOn(declaration, descriptor.name, event.type)) return state

  const expectedKey = pluginWindowKey(descriptor.name, declaration.id)
  if (input.key !== undefined && input.key !== expectedKey) return state

  const index = state.windows.findIndex((entry) => entry.key === expectedKey)
  const previous = index >= 0 ? state.windows[index]! : null
  const entry: PluginWindowEntry = {
    key: expectedKey,
    package: descriptor.name,
    id: declaration.id,
    descriptor,
    declaration,
    event,
    trigger: (previous?.trigger ?? 0) + 1,
    modal: declaration.modal === true,
    dismissible: declaration.dismissible !== false,
  }
  const windows = previous
    ? state.windows.map((item, itemIndex) => (itemIndex === index ? entry : item))
    : [...state.windows, entry]
  return { windows, focus: resolveWindowFocus(windows, state.focus) }
}

/** Close one window (idempotent); focus moves to the remaining top modal. */
export function closePluginWindow(state: PluginWindowState, key: string): PluginWindowState {
  const index = state.windows.findIndex((entry) => entry.key === key)
  if (index < 0) return state
  const windows = state.windows.filter((entry) => entry.key !== key)
  return { windows, focus: resolveWindowFocus(windows, state.focus) }
}

/**
 * Apply a committed descriptor snapshot.
 *
 * - package removed/disabled (`descriptor` gone) → close;
 * - declaration removed → close;
 * - trigger event changed → close (the open window no longer answers a valid
 *   trigger);
 * - otherwise the entry is updated (title/flags/view action) so the renderer
 *   refetches when the package revision changed;
 * - unchanged windows keep their entry (and the whole state object when
 *   nothing changed), so triggers/subscriptions are not churned.
 */
export function applyWindowRevision(
  state: PluginWindowState,
  snapshot: readonly PluginClientDescriptor[] | { plugins?: readonly PluginClientDescriptor[] } | null | undefined,
): PluginWindowState {
  const descriptors = readDescriptorSnapshot(snapshot)
  if (!descriptors) return state

  const byName = new Map<string, PluginClientDescriptor>()
  for (const descriptor of descriptors) {
    if (descriptor && typeof descriptor.name === "string" && descriptor.name.length > 0) {
      byName.set(descriptor.name, descriptor)
    }
  }

  let changed = false
  const windows: PluginWindowEntry[] = []
  for (const entry of state.windows) {
    const descriptor = byName.get(entry.package)
    if (!descriptor) {
      changed = true
      continue
    }
    const declaration = pluginWindowDeclarations(descriptor).find(
      (candidate) => candidate.id === entry.id,
    )
    if (!declaration) {
      changed = true
      continue
    }
    if (declaration.triggerEvent !== entry.declaration.triggerEvent) {
      changed = true
      continue
    }
    if (
      descriptor.revision === entry.descriptor.revision &&
      sameWindowDeclaration(declaration, entry.declaration)
    ) {
      // Same package revision + same declaration: keep the existing structural
      // inputs even when the snapshot rebuilt the descriptor object.
      windows.push(entry)
      continue
    }
    windows.push({
      ...entry,
      descriptor,
      declaration,
      modal: declaration.modal === true,
      dismissible: declaration.dismissible !== false,
    })
    changed = true
  }

  if (!changed) return state
  return { windows, focus: resolveWindowFocus(windows, state.focus) }
}

/** Topmost modal owns focus; modeless windows never do. */
export function resolveWindowFocus(
  windows: readonly PluginWindowEntry[],
  previous: PluginWindowFocusState,
): PluginWindowFocusState {
  let modalKey: string | null = null
  for (let index = windows.length - 1; index >= 0; index--) {
    const entry = windows[index]!
    if (!entry.modal) continue
    modalKey = entry.key
    break
  }
  if (modalKey === previous.modalKey) return previous
  return { modalKey, token: previous.token + 1 }
}

/** Focus-trap cycle; -1 means "focus was outside the window". */
export function cycleFocusIndex(current: number, count: number, backward: boolean): number {
  if (!Number.isFinite(count) || count <= 0) return -1
  const total = Math.floor(count)
  if (!Number.isFinite(current) || current < 0 || current >= total) {
    return backward ? total - 1 : 0
  }
  const step = backward ? -1 : 1
  return (Math.floor(current) + step + total) % total
}

// ---------------------------------------------------------------------------
// View request state machine
// ---------------------------------------------------------------------------

export type PluginWindowViewStatus = "idle" | "loading" | "ready" | "error"

export interface PluginWindowViewState {
  /** Monotonic request counter; stale responses carry an older id. */
  requestId: number
  status: PluginWindowViewStatus
  /** Last successfully normalized view (kept across errors). */
  view: PluginView | null
  error: string | null
  /** Non-view action output shown above the current view. */
  actionOutput: string | null
  /** Plugin generation captured when the latest request started. */
  generation: PluginGeneration | null
}

export const EMPTY_PLUGIN_WINDOW_VIEW_STATE: PluginWindowViewState = Object.freeze({
  requestId: 0,
  status: "idle",
  view: null,
  error: null,
  actionOutput: null,
  generation: null,
})

export function beginWindowViewRequest(
  state: PluginWindowViewState,
  generation: PluginGeneration,
): PluginWindowViewState {
  return {
    ...state,
    requestId: state.requestId + 1,
    status: "loading",
    error: null,
    generation,
  }
}

/** Apply a view response; invalid payloads keep the last good view. */
export function settleWindowView(
  state: PluginWindowViewState,
  requestId: number,
  raw: unknown,
): PluginWindowViewState {
  if (requestId !== state.requestId) return state
  const view = contract.normalizePluginView(raw)
  if (!view) return { ...state, status: "error", error: "插件视图格式无效" }
  return { ...state, status: "ready", view, error: null }
}

/** Request failure keeps the last good view and surfaces the message. */
export function failWindowView(
  state: PluginWindowViewState,
  requestId: number,
  message: string,
): PluginWindowViewState {
  if (requestId !== state.requestId) return state
  return { ...state, status: "error", error: message }
}

/**
 * Replace the view with one returned by an action widget.
 *
 * Also bumps the request id: the action response is newer than any refresh
 * still in flight, so those responses must be discarded.
 */
export function replaceWindowView(
  state: PluginWindowViewState,
  view: PluginView,
): PluginWindowViewState {
  return {
    ...state,
    requestId: state.requestId + 1,
    status: "ready",
    view,
    error: null,
    actionOutput: null,
  }
}

export function setWindowActionOutput(
  state: PluginWindowViewState,
  text: string | null,
): PluginWindowViewState {
  return { ...state, actionOutput: text }
}

export interface PluginWindowViewFetchDeps {
  invoke: () => Promise<unknown>
  /** Current plugin client generation, captured before the await. */
  generation: () => PluginGeneration
  /** Stale-boot/revision guard evaluated after the await. */
  isGenerationCurrent: (generation: PluginGeneration) => boolean
  /** Window identity (key + trigger + action + revision) captured before await. */
  identity?: () => string
}

export type PluginWindowViewFetchResult =
  | { kind: "view"; view: PluginView }
  | { kind: "error"; message: string }
  | { kind: "stale" }

/**
 * Run one `viewAction` request with both stale guards.
 *
 * A response is discarded when the plugin generation moved or the window was
 * retriggered/updated meanwhile. Failures keep the caller's last good view;
 * this helper only classifies the result.
 */
export async function fetchPluginWindowView(
  deps: PluginWindowViewFetchDeps,
): Promise<PluginWindowViewFetchResult> {
  const generation = deps.generation()
  const identity = deps.identity ? deps.identity() : undefined
  const superseded = (): boolean => {
    if (!deps.isGenerationCurrent(generation)) return true
    if (identity === undefined) return false
    return deps.identity ? deps.identity() !== identity : false
  }

  let raw: unknown
  try {
    raw = await deps.invoke()
  } catch (err) {
    if (superseded()) return { kind: "stale" }
    return { kind: "error", message: messageOf(err) }
  }
  if (superseded()) return { kind: "stale" }
  const view = contract.normalizePluginView(raw)
  if (!view) return { kind: "error", message: "插件视图格式无效" }
  return { kind: "view", view }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function readDescriptorSnapshot(
  snapshot: readonly PluginClientDescriptor[] | { plugins?: readonly PluginClientDescriptor[] } | null | undefined,
): readonly PluginClientDescriptor[] | null {
  if (Array.isArray(snapshot)) return snapshot as readonly PluginClientDescriptor[]
  if (snapshot && typeof snapshot === "object") {
    const plugins = (snapshot as { plugins?: unknown }).plugins
    if (Array.isArray(plugins)) return plugins as readonly PluginClientDescriptor[]
  }
  return null
}

function sameWindowDeclaration(
  a: PluginMessageWindowDescriptor,
  b: PluginMessageWindowDescriptor,
): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.title === b.title &&
      a.triggerEvent === b.triggerEvent &&
      a.viewAction === b.viewAction &&
      (a.modal === true) === (b.modal === true) &&
      (a.dismissible !== false) === (b.dismissible !== false))
  )
}

function normalizeWindowEvent(
  event: PluginWindowEventPayload | null | undefined,
): PluginWindowEventPayload | null {
  if (!event || typeof event !== "object") return null
  if (typeof event.type !== "string" || event.type.length === 0) return null
  const normalized: PluginWindowEventPayload = { type: event.type }
  if ("properties" in event) normalized.properties = event.properties
  if (typeof event.sessionID === "string" && event.sessionID.length > 0) {
    normalized.sessionID = event.sessionID
  }
  return normalized
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
