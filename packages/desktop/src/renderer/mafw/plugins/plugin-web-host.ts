// Task 8: pure host model for `PluginWebSurfaceHost`.
//
// Two decisions are worth testing without a browser:
//
// - **binding identity** — main mints one ticket/partition per
//   `(pkg, projectDir, sessionID?)` (Task 6 ruling). A session-scoped surface
//   therefore has to be *rebuilt* (new partition, new cookie) when the active
//   session changes; a project/global surface, or one that opted out with
//   `reloadOnSessionChange: false`, keeps its page and only receives a
//   `context` push. The binding key is what the host compares.
// - **ticket renewal** — the host re-runs `prepareWebSurface` at
//   `expiresAt - 30min` (spec §5.7) and must never schedule a hot loop or let
//   `setTimeout` overflow.
//
// No Electron, no DOM, no Solid: the component is the only consumer.
import type { PluginWebSurfaceView } from "./plugin-web-surface"

/** Refresh the ticket this long before it expires (spec §5.7). */
export const PLUGIN_WEB_REFRESH_LEAD_MS = 30 * 60 * 1000
/** Floor for the refresh timer so a stale/expired ticket cannot hot-loop. */
export const PLUGIN_WEB_REFRESH_MIN_MS = 60 * 1000
/** `setTimeout` stores a signed 32-bit int; longer delays fire immediately. */
export const PLUGIN_WEB_TIMER_MAX_MS = 2_147_483_647

export interface PluginWebSurfaceBinding {
  projectDir: string
  sessionID?: string
}

/** What the page sees: the live binding, narrowed to the declared scope. */
export interface PluginWebSurfaceContext {
  /** Absent for `scope: "global"` (the surface is not bound to a project). */
  projectDir?: string
  /** Present only for `scope: "session"`. */
  sessionID?: string
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * True when the surface is rebuilt on session change.
 *
 * Only `scope: "session"` surfaces that did not opt out bind the active
 * session *identity* (the webview key). `reloadOnSessionChange: false` means
 * "keep the page and the ticket it opened with; push a context change instead"
 * — the page then issues actions with the new `sessionID` through the bridge.
 */
export function webSurfaceBindsSession(view: PluginWebSurfaceView): boolean {
  return view.scope === "session" && view.reloadOnSessionChange !== false
}

/**
 * Binding handed to `prepareWebSurface` (decides partition, ticket and cookie).
 *
 * Session-scoped surfaces always bind their session — even when they opted out
 * of reloading — so two windows in one project never share a cookie store.
 * Opting out only stops the *remount*; the page keeps its opening ticket.
 */
export function webSurfaceBinding(
  view: PluginWebSurfaceView,
  projectDir: string,
  sessionID?: string | null,
): PluginWebSurfaceBinding {
  const binding: PluginWebSurfaceBinding = { projectDir: trimmed(projectDir) }
  const session = view.scope === "session" ? trimmed(sessionID) : ""
  if (session.length > 0) binding.sessionID = session
  return binding
}

/**
 * Live context pushed to the page (and returned by `context()`).
 *
 * Scope-gated, per spec §5.8: `session` surfaces see `projectDir + sessionID`,
 * `project` surfaces see `projectDir` only, and `global` surfaces see neither
 * (they are not bound to a project — the tab still belongs to one project).
 *
 * Independent of the ticket scope: `reloadOnSessionChange: false` keeps the
 * opening ticket/partition but the page still learns that the active session
 * moved (spec §5.8 `contextChange`), so its `invoke` calls target the new one.
 */
export function webSurfaceContext(
  view: PluginWebSurfaceView,
  projectDir: string,
  sessionID?: string | null,
): PluginWebSurfaceContext {
  const context: PluginWebSurfaceContext = {}
  const project = view.scope === "global" ? "" : trimmed(projectDir)
  if (project.length > 0) context.projectDir = project
  const session = view.scope === "session" ? trimmed(sessionID) : ""
  if (session.length > 0) context.sessionID = session
  return context
}

/**
 * Identity of one mounted webview: anything in here changing requires a new
 * `<webview>` (new partition + cookie); everything else is a push.
 */
export function webSurfaceBindingKey(
  view: PluginWebSurfaceView,
  projectDir: string,
  sessionID?: string | null,
): string {
  const binding = webSurfaceBinding(view, projectDir, sessionID)
  // Only rebinding surfaces carry the session in their identity; an opted-out
  // surface keeps its page (and opening ticket) when the session moves.
  const session = webSurfaceBindsSession(view) ? binding.sessionID ?? "" : ""
  return [
    view.packageName,
    view.surfaceId,
    view.revision,
    binding.projectDir,
    session,
  ].join("\u0000")
}

/** Delay until the ticket refresh run, clamped to [1min, setTimeout ceiling]. */
export function pluginWebRefreshDelay(expiresAt: number, now: number): number {
  const target = Number.isNaN(expiresAt) ? now : expiresAt - PLUGIN_WEB_REFRESH_LEAD_MS
  const delay = target - now
  if (!Number.isFinite(delay)) return delay > 0 ? PLUGIN_WEB_TIMER_MAX_MS : PLUGIN_WEB_REFRESH_MIN_MS
  return Math.min(PLUGIN_WEB_TIMER_MAX_MS, Math.max(PLUGIN_WEB_REFRESH_MIN_MS, Math.floor(delay)))
}

/** Banner text for a failed surface load (`did-fail-load` / HTTP status). */
export function pluginWebLoadErrorMessage(
  status: number | null | undefined,
  description: string | null | undefined,
): string {
  const code = typeof status === "number" && Number.isFinite(status) && status > 0 ? Math.floor(status) : 0
  if (code > 0) return `插件页面加载失败（HTTP ${code}）`
  const detail = trimmed(description)
  return detail.length > 0 ? `插件页面加载失败：${detail}` : "插件页面加载失败"
}

/**
 * What the host does after a top-level navigation finished with an HTTP status.
 *
 * - 2xx/3xx → healthy: clear a previous error and re-arm the one-shot retry.
 * - 403 → ticket missing/expired/revoked: renew the cookie and retry once
 *   (spec §5.7); the retry path falls back to the banner when that also fails.
 * - any other 4xx/5xx (incl. 404) → the page is not there (missing entry,
 *   fail-closed package, CSP) — a fresh ticket cannot create the file, so the
 *   banner shows immediately (spec §3.3: never a white page). Manual 重试 still
 *   covers the "revision just landed" race.
 * - 0 / 1xx (non-HTTP document, provisional) → nothing to say.
 */
export type PluginWebNavigationOutcome =
  | { kind: "healthy" }
  | { kind: "renew-ticket"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ignore" }

export function pluginWebNavigationOutcome(
  status: number | null | undefined,
): PluginWebNavigationOutcome {
  const code = typeof status === "number" && Number.isFinite(status) ? Math.floor(status) : 0
  if (code >= 200 && code < 400) return { kind: "healthy" }
  if (code === 403) return { kind: "renew-ticket", message: pluginWebLoadErrorMessage(403, "") }
  if (code >= 400) return { kind: "error", message: pluginWebLoadErrorMessage(code, "") }
  return { kind: "ignore" }
}
