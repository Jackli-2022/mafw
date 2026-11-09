// packages/desktop/src/main/plugin-web-session.ts
// Plugin web surfaces: sandboxed per-binding partitions + path-scoped ticket
// cookies (spec 2026-11-09 §5.5/§6.2). Pure decisions live here so they run
// under `node --test`; the electron calls arrive through injected deps
// (`mafw-ipc.ts` wires `session.fromPartition` / `BrowserWindow`).
//
// Isolation model — read before changing the filter:
// - Each surface binding `(pkg, projectDir, sessionID?)` gets its own
//   `persist:` partition, and `onBeforeRequest` cancels every request that is
//   not one of the package's *page* subpaths: `ui/…`, `api/…`, `ws/…` and
//   `events`. Everything else under `/api/plugins/<pkg>/` is refused, notably
//   the host-control routes that share the namespace: `web-ticket`, `apply`,
//   `reload` and `actions/:action`.
//   Paths are normalized exactly like the gateway router (trailing slashes
//   stripped, empty segments dropped), so `/demo//web-ticket` cannot slip past
//   the deny while the gateway still routes it to the ticket handler.
//   That filter is the *real* package isolation: the gateway treats any
//   loopback request without a valid ticket as the ambient project (dev/curl
//   affordance), so without the filter a compromised page could reach another
//   package's namespace, or the whole gateway API. `web-ticket` is refused
//   because it accepts any registered project and ignores a presented ticket:
//   letting the page mint one would make its `ctx.http` project binding
//   page-controllable (and could overwrite the partition cookie). `apply` /
//   `reload` / `actions` are refused because they are host privileges, not page
//   APIs.
// - One partition per *binding* (not per package): tickets are bucketed per
//   `(pkg, projectDir, sessionID)`, so a shared package cookie would let a
//   second window silently flip the first surface onto its project/session.
// - `will-attach-webview` force-installs the bridge preload and strips node
//   capabilities, and only for partitions main prepared (a forged binding hash
//   fails closed). `browser-session.ts` skips plugin partitions so the browser
//   guest rules never strip that preload; plugin guests also get their own
//   `window.open` policy (deny + system browser, never the browser dock).
// - Only loopback webviews are supported: remote gateways need the global API
//   token as well as the ticket, and the desktop has no story for that yet.
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** Prefix of every plugin surface partition (contract-level, keep stable). */
export const PLUGIN_WEB_PARTITION_PREFIX = "persist:mafw-plugin-"
/** Must match `gateway/src/routes/plugin-web.ts` (path-scoped cookie). */
export const PLUGIN_WEB_TICKET_COOKIE = "mafw_plugin_ticket"
/** Package names are contract-validated; this is the pre-network gate. */
const PLUGIN_WEB_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEFAULT_WEB_ENTRY = "index.html"
const LOOPBACK_HTTP_PROTOCOLS = new Set(["http:", "ws:"])
const LOOPBACK_SECURE_PROTOCOLS = new Set(["https:", "wss:"])
// `~` is not allowed in a package name, so `<pkg>~<hash>` is unambiguous.
const BINDING_SEPARATOR = "~"
const BINDING_HASH_PATTERN = /^[0-9a-f]{12}$/
// The page may only reach its own package's *page* surfaces. Host-management
// routes share the namespace (`apply` / `reload` / `actions/:action` /
// `web-ticket`), so an allowlist of subpaths is the only safe filter.
const PACKAGE_ROUTE_PREFIXES = ["/ui", "/api", "/ws"]
const PACKAGE_ROUTE_EXACT = "/events"

const here = dirname(fileURLToPath(import.meta.url))

/** Context a surface is bound to; also the partition identity. */
export interface PluginWebBinding {
  projectDir: string
  sessionID?: string
}

/** Stable short hash of the binding (same binding → same partition). */
export function pluginWebBindingHash(binding: PluginWebBinding): string {
  const key = `${binding.projectDir}\u0000${binding.sessionID ?? ""}`
  return createHash("sha256").update(key, "utf8").digest("hex").slice(0, 12)
}

/**
 * One partition per `(pkg, binding)`: `persist:mafw-plugin-<pkg>~<hash>`.
 * Different bindings never share a cookie store, so two windows on the same
 * package cannot flip each other's project/session.
 */
export function pluginWebPartition(pkg: string, binding: PluginWebBinding): string {
  return `${PLUGIN_WEB_PARTITION_PREFIX}${pkg}${BINDING_SEPARATOR}${pluginWebBindingHash(binding)}`
}

/**
 * Inverse of `pluginWebPartition`; `null` for partitions this module does not
 * own. Partitions without a binding hash are rejected (fail-closed): an
 * unconfigured `persist:mafw-plugin-*` must never be attached.
 */
export function pluginWebPartitionPackage(partition: string | null | undefined): string | null {
  if (typeof partition !== "string") return null
  if (!partition.startsWith(PLUGIN_WEB_PARTITION_PREFIX)) return null
  const rest = partition.slice(PLUGIN_WEB_PARTITION_PREFIX.length)
  const separator = rest.lastIndexOf(BINDING_SEPARATOR)
  if (separator <= 0) return null
  const pkg = rest.slice(0, separator)
  const hash = rest.slice(separator + 1)
  if (!PLUGIN_WEB_NAME_PATTERN.test(pkg) || !BINDING_HASH_PATTERN.test(hash)) return null
  return pkg
}

/** Path-scoped to the package namespace so a cookie can never reach another package. */
export function pluginWebCookiePath(pkg: string): string {
  return `/api/plugins/${pkg}/`
}

/** `""` / missing → `index.html`; leading slashes are not part of a relative entry. */
export function normalizePluginWebEntry(entry?: string | null): string {
  const value = typeof entry === "string" ? entry.trim().replace(/^\/+/, "") : ""
  return value.length > 0 ? value : DEFAULT_WEB_ENTRY
}

/**
 * `src` for the surface `<webview>`: gateway origin + package namespace + entry,
 * with the committed revision as a cache-busting query token.
 *
 * Dot segments are dropped: the gateway resolver rejects them anyway, and the
 * surface URL must never be able to point outside `/api/plugins/<pkg>/ui/`.
 */
export function pluginWebUrl(
  gatewayUrl: string,
  pkg: string,
  entry?: string | null,
  revision?: string | null,
): string {
  const base = gatewayUrl.replace(/\/+$/, "")
  const rel = normalizePluginWebEntry(entry)
    .split("/")
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  const url = `${base}/api/plugins/${encodeURIComponent(pkg)}/ui/${rel || DEFAULT_WEB_ENTRY}`
  return revision ? `${url}?revision=${encodeURIComponent(revision)}` : url
}

/** `out/preload/plugin-web.js` next to `out/main/` (electron-vite layout). */
export function pluginWebPreloadPath(baseDir: string = here): string {
  return join(baseDir, "../preload/plugin-web.js")
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * Mirror of the gateway router's path normalization
 * (`gateway/src/routes/registry.ts` `match()`: `split('?')[0].replace(/\/+$/, '')`
 * then `split('/').filter(s => s.length > 0)`).
 *
 * WHATWG URL parsing keeps empty segments, so `/demo//web-ticket` would
 * otherwise pass the namespace check while the gateway still routes it to
 * `plugins.webTicket` (the page could re-bind its own project context).
 */
function normalizeRoutePath(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "")
  return collapsed.length > 0 ? collapsed : "/"
}

/**
 * True when `requestUrl` targets the gateway origin and one of this package's
 * page subpaths (`ui/`, `api/`, `ws/`, `events`).
 *
 * The trailing-slash boundary keeps `demo` from matching `demo2`. Host-control
 * routes that share the same namespace (`apply`, `reload`, `actions/:action`,
 * `web-ticket`) are refused: `web-ticket` would let the sandboxed page bind its
 * own context to any registered project, and the other two would let it drive
 * package lifecycle as the host. Paths are normalized the same way the gateway
 * router normalizes them, so empty segments cannot slip the allowlist.
 */
export function pluginWebRequestAllowed(gatewayUrl: string, pkg: string, requestUrl: string): boolean {
  const gateway = parseUrl(gatewayUrl)
  const request = parseUrl(requestUrl)
  if (!gateway || !request) return false
  if (!PLUGIN_WEB_NAME_PATTERN.test(pkg)) return false

  const protocols = gateway.protocol === "https:" ? LOOPBACK_SECURE_PROTOCOLS : LOOPBACK_HTTP_PROTOCOLS
  if (!protocols.has(request.protocol)) return false
  if (request.host !== gateway.host) return false

  const pathname = normalizeRoutePath(request.pathname)
  const base = `/api/plugins/${pkg}`
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false
  // `new URL` already resolves dot segments; empty segments are collapsed above.
  return pluginWebSubpathAllowed(pathname.slice(base.length))
}

/** `/ui/...`, `/api/...`, `/ws/...` or exactly `/events`. */
function pluginWebSubpathAllowed(rest: string): boolean {
  if (rest === PACKAGE_ROUTE_EXACT) return true
  for (const prefix of PACKAGE_ROUTE_PREFIXES) {
    if (rest === prefix || rest.startsWith(`${prefix}/`)) return true
  }
  return false
}

export type PluginWebAttachDecision =
  | { ok: true; pkg: string }
  | { ok: false; pkg: string | null; reason: string }

/**
 * Attach gate for one `will-attach-webview` event.
 *
 * `isConfigured` is the belt to the partition shape's braces: a surface can
 * only attach after main minted a ticket for that exact binding (which is when
 * the partition becomes known). A forged hash with the right shape therefore
 * fails closed instead of opening an unconfigured cookie store.
 */
export function pluginWebAttachDecision(
  gatewayUrl: string,
  partition: string | null | undefined,
  src: string | null | undefined,
  isConfigured?: (partition: string) => boolean,
): PluginWebAttachDecision {
  const pkg = pluginWebPartitionPackage(partition)
  if (!pkg) return { ok: false, pkg: null, reason: "not a plugin web partition" }
  if (isConfigured && !isConfigured(partition as string)) {
    return { ok: false, pkg, reason: "partition is not configured" }
  }

  const value = typeof src === "string" ? src.trim() : ""
  if (value.length === 0 || value === "about:blank") return { ok: true, pkg }
  if (!pluginWebRequestAllowed(gatewayUrl, pkg, value)) {
    return { ok: false, pkg, reason: "src is outside the package namespace" }
  }
  return { ok: true, pkg }
}

/**
 * `window.open` / `target=_blank` decision for a *plugin* guest.
 *
 * Plugin pages must never open windows (the sandbox is the point). A legacy
 * `window.open("https://…")` is proxied to the system browser by the host; the
 * workbench browser dock is deliberately not a destination (it would inherit a
 * different partition and its own guest policy). The supported route is the
 * bridge's `openExternal`.
 */
export type PluginWebWindowOpenAction = { action: "external"; url: string } | { action: "deny" }

export function pluginWebWindowOpenAction(raw: unknown): PluginWebWindowOpenAction {
  const value = typeof raw === "string" ? raw.trim() : ""
  if (value.length === 0) return { action: "deny" }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { action: "deny" }
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol === "http:" || protocol === "https:" || protocol === "mailto:" || protocol === "tel:") {
    return { action: "external", url: value }
  }
  return { action: "deny" }
}

// ── session-level policy (injected electron shapes) ──

export interface PluginWebCookieDetails {
  url: string
  name: string
  value: string
  path: string
  httpOnly: boolean
  sameSite: "strict"
  expirationDate: number
}

/** Structural subset of Electron `Session` used by this module. */
export interface PluginWebSessionLike {
  setPermissionRequestHandler(handler: ((wc: unknown, permission: string, callback: (granted: boolean) => void) => void) | null): void
  setPermissionCheckHandler(handler: ((wc: unknown, permission: string, origin: string) => boolean) | null): void
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void,
    ): void
  }
  cookies: {
    set(details: PluginWebCookieDetails): Promise<void>
  }
}

export interface PluginWebPreferences {
  preload?: string
  nodeIntegration?: boolean
  contextIsolation?: boolean
  sandbox?: boolean
  webSecurity?: boolean
  webviewTag?: boolean
}

export type PluginWebviewAttachListener = (
  event: { preventDefault(): void },
  webPreferences: PluginWebPreferences,
  params: { partition?: string; src?: string },
) => void

/** Structural subset of Electron `WebContents` (only the attach hook). */
export interface PluginWebHostLike {
  on(event: "will-attach-webview", listener: PluginWebviewAttachListener): void
}

/** Deny permissions + confine the partition to one package namespace (no ticket minting). */
export function applyPluginWebSessionPolicy(
  ses: PluginWebSessionLike,
  gatewayUrl: () => string,
  pkg: string,
): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  // Matches http(s)/ws(s); other schemes are never reachable from a sandboxed
  // page (no node integration, no file: navigation) and are handled by the
  // guest's webPreferences.
  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    callback({ cancel: !pluginWebRequestAllowed(gatewayUrl(), pkg, details.url) })
  })
}

/** Force the bridge preload + strip node capabilities on our partitions only. */
export function applyPluginWebviewAttachPolicy(
  host: PluginWebHostLike,
  gatewayUrl: () => string,
  preloadPath: string = pluginWebPreloadPath(),
): void {
  host.on("will-attach-webview", (event, webPreferences, params) => {
    const decision = pluginWebAttachDecision(
      gatewayUrl(),
      params.partition,
      params.src,
      isPluginWebPartitionConfigured,
    )
    if (!decision.ok) {
      // Foreign partitions belong to browser-session.ts; only veto our own.
      if (decision.pkg) event.preventDefault()
      return
    }
    webPreferences.preload = preloadPath
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.webviewTag = false
  })
}

// ── composition (electron-facing) ──

// Partition strings that main prepared at least once (see `pluginWebAttachDecision`).
// Insert-only: a live webview must survive a reload after its binding was
// configured, and the strings are small (one per package × project × session).
const configuredPartitions = new Set<string>()
let configuredSessions = new WeakSet<object>()
let wiredHosts = new WeakSet<object>()
let registeredHostFactories = new WeakSet<object>()

/** True when this exact partition (package + binding hash) was prepared by main. */
export function isPluginWebPartitionConfigured(partition: string | null | undefined): boolean {
  return typeof partition === "string" && configuredPartitions.has(partition)
}

/** True when `ses` is one of the plugin surface sessions (not the browser dock's). */
export function isPluginWebSession(ses: unknown): boolean {
  return !!ses && typeof ses === "object" && configuredSessions.has(ses as object)
}

/** Test-only: forget every configured partition/session/host. */
export function resetPluginWebSessionsForTests(): void {
  configuredPartitions.clear()
  configuredSessions = new WeakSet<object>()
  wiredHosts = new WeakSet<object>()
  registeredHostFactories = new WeakSet<object>()
}

export interface PluginWebSessionDeps {
  /** Read lazily: the gateway port changes across restarts. */
  gatewayUrl(): string
  fromPartition(partition: string): PluginWebSessionLike
  /** Host windows whose `will-attach-webview` must be hardened. */
  hosts(): PluginWebHostLike[]
  /** Optional factory so windows created later are hardened too. */
  onHostCreated?(listener: (host: PluginWebHostLike) => void): void
  preloadPath?: string
}

/**
 * Configure one surface binding: partition policy + `will-attach-webview` on
 * every host. Idempotent per session/host object; safe to call before every
 * surface.
 *
 * @returns the binding's Electron session (the caller installs the cookie).
 */
export function configurePluginWebSession(
  pkg: string,
  binding: PluginWebBinding,
  deps: PluginWebSessionDeps,
): PluginWebSessionLike {
  const partition = pluginWebPartition(pkg, binding)
  // Register before the webview can attach: `will-attach-webview` fails closed
  // for partitions main has never prepared.
  configuredPartitions.add(partition)
  const ses = deps.fromPartition(partition)
  // Re-registering would replace the listener anyway, but the closure reads the
  // gateway URL lazily, so wiring once per session is enough.
  if (!configuredSessions.has(ses as object)) {
    applyPluginWebSessionPolicy(ses, deps.gatewayUrl, pkg)
    configuredSessions.add(ses as object)
  }

  const preload = deps.preloadPath ?? pluginWebPreloadPath()
  for (const host of deps.hosts()) {
    if (wiredHosts.has(host as object)) continue
    applyPluginWebviewAttachPolicy(host, deps.gatewayUrl, preload)
    wiredHosts.add(host as object)
  }

  const factory = deps.onHostCreated
  if (factory && !registeredHostFactories.has(factory as object)) {
    registeredHostFactories.add(factory as object)
    factory((host) => {
      if (wiredHosts.has(host as object)) return
      applyPluginWebviewAttachPolicy(host, deps.gatewayUrl, preload)
      wiredHosts.add(host as object)
    })
  }
  return ses
}

// ── IPC-facing preparer ──

export interface PluginWebPrepareInput {
  name: string
  /** Registered project the surface is bound to (never the gateway cwd). */
  projectDir: string
  sessionID?: string
  entry?: string
  revision?: string
}

export interface PluginWebPrepareResult {
  partition: string
  url: string
  expiresAt: number
}

export interface PluginWebSessionPreparerDeps {
  gatewayUrl(): string
  issueTicket(
    name: string,
    input: { projectDir: string; sessionID?: string },
  ): Promise<{ ticket: string; expiresAt: number }>
  fromPartition(partition: string): PluginWebSessionLike
  hosts(): PluginWebHostLike[]
  onHostCreated?(listener: (host: PluginWebHostLike) => void): void
  preloadPath?: string
  log?(message: string, detail?: Record<string, unknown>, level?: "info" | "warn"): void
}

export interface PluginWebSessionPreparer {
  prepare(input: PluginWebPrepareInput): Promise<PluginWebPrepareResult>
  /** Most recent ticket expiry (epoch ms) per surface partition — the host schedules renewal. */
  expiresAtFor(partition: string): number | undefined
}

/**
 * One `prepareWebSurface` call = a fresh ticket + cookie in the binding's
 * partition (the gateway revokes the previous ticket for the same binding, so
 * the cookie must always be replaced). The renderer calls this again at
 * `expiresAt - 30min` and after any 403.
 */
export function createPluginWebSessionPreparer(deps: PluginWebSessionPreparerDeps): PluginWebSessionPreparer {
  const expiresAtByPartition = new Map<string, number>()

  return {
    async prepare(input: PluginWebPrepareInput): Promise<PluginWebPrepareResult> {
      const name = typeof input?.name === "string" ? input.name.trim() : ""
      if (!PLUGIN_WEB_NAME_PATTERN.test(name)) {
        throw new Error(`invalid plugin package name: ${JSON.stringify(input?.name ?? "")}`)
      }
      const projectDir = typeof input.projectDir === "string" ? input.projectDir.trim() : ""
      if (!projectDir) throw new Error("plugin web surface requires a projectDir")
      const sessionID =
        typeof input.sessionID === "string" && input.sessionID.trim().length > 0
          ? input.sessionID.trim()
          : undefined
      const binding: PluginWebBinding = { projectDir, ...(sessionID ? { sessionID } : {}) }

      try {
        const gatewayUrl = deps.gatewayUrl().replace(/\/+$/, "")
        if (!gatewayUrl) throw new Error("MAFW Gateway is not ready")
        const ticket = await deps.issueTicket(name, {
          projectDir,
          ...(sessionID ? { sessionID } : {}),
        })

        const ses = configurePluginWebSession(name, binding, deps)
        const partition = pluginWebPartition(name, binding)
        await ses.cookies.set({
          url: gatewayUrl,
          name: PLUGIN_WEB_TICKET_COOKIE,
          value: ticket.ticket,
          path: pluginWebCookiePath(name),
          httpOnly: true,
          sameSite: "strict",
          expirationDate: Math.floor(ticket.expiresAt / 1000),
        })

        expiresAtByPartition.set(partition, ticket.expiresAt)
        const url = pluginWebUrl(gatewayUrl, name, input.entry, input.revision)
        deps.log?.("plugin web session prepared", { pkg: name, partition, expiresAt: ticket.expiresAt }, "info")
        return { partition, url, expiresAt: ticket.expiresAt }
      } catch (err) {
        deps.log?.("plugin web session failed", { pkg: name, error: String(err) }, "warn")
        throw err
      }
    },

    expiresAtFor(partition: string): number | undefined {
      return expiresAtByPartition.get(partition)
    },
  }
}
