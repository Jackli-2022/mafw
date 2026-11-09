// Task 8: sandboxed plugin web surface host.
//
// One committed `webSurfaces` entry = one `<webview>` in the package's own
// persisted partition (package + binding hash). Main mints the ticket
// (`plugins.prepareWebSurface`), installs it as a path-scoped cookie and returns
// `{partition, url, expiresAt}`; the renderer takes all three **verbatim** — the
// binding hash is main's business and a renderer that recomputed it could point
// at another window's cookie store.
//
// Lifecycle (spec 2026-11-09 §5.7/§6.2/§6.5):
// - mount: prepare → create `<webview>` → set src;
// - `expiresAt - 30min`: prepare again (fresh cookie), then `reload()`;
// - HTTP 403: renew the ticket and retry once; first network load failure: same;
// - any other 4xx/5xx (incl. 404) or a failed retry: `DockBanner` with a manual
//   retry — a missing entry never renders as a white page (spec §3.3);
// - session change: session-scoped surfaces are rebuilt with the new binding
//   (new partition + cookie); project/global surfaces and pages that opted out
//   via `reloadOnSessionChange: false` only receive a `context` push;
// - teardown: the page's badge and title are cleared (nothing the page
//   published outlives it).
//
// The page half is `src/preload/plugin-web.ts`; the message router is the pure
// `plugin-web-bridge.ts` (unit tested).
import { Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { PLUGIN_WEB_BRIDGE_CHANNEL, PLUGIN_WEB_MAX_TITLE_LENGTH, type PluginWebTheme } from "../../../shared/plugin-web-bridge"
import { DockBanner } from "../components/dock-panel"
import { createPluginWebBridge, type PluginWebBridge, type PluginWebBridgePush } from "./plugin-web-bridge"
import {
  pluginWebLoadErrorMessage,
  pluginWebNavigationOutcome,
  pluginWebRefreshDelay,
  webSurfaceBinding,
  webSurfaceBindingKey,
  webSurfaceBindsSession,
  webSurfaceContext,
} from "./plugin-web-host"
import { subscribePluginEvent } from "./plugin-store"
import type { PluginWebSurfaceContext } from "./plugin-web-host"
import type { PluginWebSurfaceView } from "./plugin-web-surface"

export interface PluginWebSurfaceHostProps {
  view: PluginWebSurfaceView
  /** Gateway origin; a change (restart on another port) rebuilds the surface. */
  gatewayUrl: string
  sessionID?: string | null
  projectDir: string
  onBadge?(count: number): void
  onTitle?(title: string): void
  onError?(message: string): void
}

export function PluginWebSurfaceHost(props: PluginWebSurfaceHostProps) {
  let hostEl: HTMLDivElement | undefined
  let current: any = null
  let bridge: PluginWebBridge | null = null
  let generation = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let retryUsed = false
  let mounted = false

  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const themeListeners = new Set<(theme: PluginWebTheme) => void>()
  const contextListeners = new Set<(context: PluginWebSurfaceContext) => void>()
  // Badge/title the page published (null = it never did). Cleared on teardown so
  // a removed surface cannot leave a stale count on the rail or a stale label on
  // the tab strip (the declared title is the fallback the shell applies).
  let publishedBadge: number | null = null
  let publishedTitle: string | null = null

  const binding = () => webSurfaceBinding(props.view, props.projectDir, props.sessionID)
  const currentTheme = (): PluginWebTheme =>
    document.documentElement.dataset.colorScheme === "light" ? "light" : "dark"

  const report = (message: string): void => {
    setError(message)
    props.onError?.(message)
  }

  /** Bridge `setBadge` — keep the last value so teardown can clear it. */
  const publishBadge = (count: number): void => {
    const next = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    publishedBadge = next
    props.onBadge?.(next)
  }

  /** Bridge `setTitle` / `<title>` — empty means "fall back to the declared title". */
  const publishTitle = (title: string): void => {
    const trimmed = typeof title === "string" ? title.trim() : ""
    // The page can emit a `<title>` on every frame; cap it before it reaches
    // the tab strip (the bridge caps `setTitle`, this covers `page-title-updated`).
    const next = trimmed.slice(0, PLUGIN_WEB_MAX_TITLE_LENGTH)
    publishedTitle = next.length > 0 ? next : null
    props.onTitle?.(next)
  }

  const sendToPage = (el: any, frame: PluginWebBridgePush | unknown): void => {
    try {
      el?.send?.(PLUGIN_WEB_BRIDGE_CHANNEL, frame)
    } catch {
      /* page navigated away mid-send */
    }
  }

  const clearRefresh = (): void => {
    if (!refreshTimer) return
    clearTimeout(refreshTimer)
    refreshTimer = null
  }

  const teardown = (): void => {
    generation += 1
    clearRefresh()
    bridge?.dispose()
    bridge = null
    themeListeners.clear()
    contextListeners.clear()
    retryUsed = false
    if (publishedBadge !== null) {
      publishedBadge = null
      props.onBadge?.(0)
    }
    if (publishedTitle !== null) {
      publishedTitle = null
      props.onTitle?.("")
    }
    if (current) {
      try {
        current.remove()
      } catch {
        /* already detached */
      }
      current = null
    }
    hostEl?.replaceChildren()
  }

  /** Main owns binding → partition → cookie; the renderer just asks. */
  const prepareSurface = () => {
    const view = props.view
    const target = binding()
    if (!target.projectDir) return Promise.reject(new Error("插件页面需要一个项目上下文"))
    return window.api.mafw.plugins.prepareWebSurface(view.packageName, {
      projectDir: target.projectDir,
      ...(target.sessionID ? { sessionID: target.sessionID } : {}),
      entry: view.entry,
      revision: view.revision,
    })
  }

  const scheduleRefresh = (expiresAt: number): void => {
    clearRefresh()
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refreshTicket()
    }, pluginWebRefreshDelay(expiresAt, Date.now()))
  }

  const refreshTicket = async (): Promise<void> => {
    const token = generation
    try {
      const prepared = await prepareSurface()
      if (token !== generation) return
      scheduleRefresh(prepared.expiresAt)
      try {
        current?.reload?.()
      } catch {
        /* webview destroyed between prepare and reload */
      }
    } catch (err) {
      if (token === generation) report(`插件票据续期失败：${messageOf(err)}`)
    }
  }

  /** One automatic recovery per surface: fresh ticket, then a visible banner. */
  const retryLoad = async (message: string): Promise<void> => {
    if (retryUsed) {
      report(message)
      return
    }
    retryUsed = true
    const token = generation
    try {
      const prepared = await prepareSurface()
      if (token !== generation) return
      scheduleRefresh(prepared.expiresAt)
      try {
        current?.reload?.()
      } catch {
        /* ignore */
      }
    } catch {
      if (token === generation) report(message)
    }
  }

  const pushTheme = (): void => {
    const theme = currentTheme()
    for (const listener of [...themeListeners]) {
      try {
        listener(theme)
      } catch {
        /* page handler failure is not the host's */
      }
    }
  }

  const pushContext = (): void => {
    // Live context, not the ticket binding: pages that opted out of reloading
    // still follow the active session through `contextChange` (spec §5.8).
    const context = webSurfaceContext(props.view, props.projectDir, props.sessionID)
    for (const listener of [...contextListeners]) {
      try {
        listener(context)
      } catch {
        /* ignore */
      }
    }
  }

  const createBridge = (el: any): PluginWebBridge =>
    createPluginWebBridge({
      pkg: props.view.packageName,
      surface: props.view.surfaceId,
      context: () => ({ ...webSurfaceContext(props.view, props.projectDir, props.sessionID), theme: currentTheme() }),
      invoke: (pkg, action, input) =>
        window.api.mafw.plugins.invoke(pkg, action, input, props.sessionID ?? undefined),
      setBadge: (count) => publishBadge(count),
      setTitle: (title) => publishTitle(title),
      openExternal: (url) => {
        void window.api.browser.openExternal(url)
      },
      // Package events arrive on the shell's single SSE stream and are routed by
      // the committed-descriptor store (`plugin:<pkg>:*` only).
      subscribeEvent: (type, listener) =>
        subscribePluginEvent(type, (notice) => listener(notice.properties)),
      subscribeTheme: (listener) => {
        themeListeners.add(listener)
        return () => {
          themeListeners.delete(listener)
        }
      },
      subscribeContext: (listener) => {
        contextListeners.add(listener)
        return () => {
          contextListeners.delete(listener)
        }
      },
      send: (push) => sendToPage(el, push),
      onError: (message) => report(message),
    })

  const onPageMessage = async (event: any): Promise<void> => {
    if (event?.channel !== PLUGIN_WEB_BRIDGE_CHANNEL) return
    const el = current
    if (!el) return
    const message = Array.isArray(event.args) ? event.args[0] : event.args
    try {
      const reply = await bridge?.handle(message)
      if (reply && current === el) sendToPage(el, reply)
    } catch (err) {
      const id =
        message && typeof message === "object" && "id" in message
          ? (message as { id?: unknown }).id ?? 0
          : 0
      sendToPage(el, { id, ok: false, error: messageOf(err) })
    }
  }

  const mount = async (): Promise<void> => {
    teardown()
    const token = generation
    setError(null)
    setLoading(true)

    let prepared: { partition: string; url: string; expiresAt: number }
    try {
      prepared = await prepareSurface()
    } catch (err) {
      if (token !== generation) return
      setLoading(false)
      report(`插件页面准备失败：${messageOf(err)}`)
      return
    }
    if (token !== generation || !hostEl) return

    // <webview> is an Electron custom element: JSX cannot type it, same
    // imperative pattern as BrowserDock.
    const el = document.createElement("webview") as any
    el.className = "mafw-plugin-web-view"
    // Returned by main; never recomputed here (see the module header).
    el.setAttribute("partition", prepared.partition)
    el.setAttribute(
      "webpreferences",
      "contextIsolation=yes, sandbox=yes, nodeIntegration=no, webSecurity=yes",
    )
    el.addEventListener("did-start-loading", () => setLoading(true))
    el.addEventListener("did-stop-loading", () => setLoading(false))
    el.addEventListener("dom-ready", () => {
      pushTheme()
      pushContext()
    })
    el.addEventListener("page-title-updated", (event: any) => {
      const title = typeof event?.title === "string" ? event.title.trim() : ""
      if (title.length > 0) publishTitle(title)
    })
    el.addEventListener("did-navigate", (event: any) => {
      const outcome = pluginWebNavigationOutcome(Number(event?.httpResponseCode ?? 0))
      if (outcome.kind === "healthy") {
        retryUsed = false
        setError(null)
        return
      }
      if (outcome.kind === "ignore") return
      if (outcome.kind === "renew-ticket") {
        // Ticket expired or was revoked: refresh the cookie, then retry once.
        void retryLoad(outcome.message)
        return
      }
      // 404/5xx: the entry is gone (or the package failed closed). A fresh
      // ticket cannot create the file, so surface the banner right away.
      report(outcome.message)
    })
    el.addEventListener("did-fail-load", (event: any) => {
      if (event?.errorCode === -3 || event?.isMainFrame === false) return
      const description = String(event?.errorDescription ?? event?.errorCode ?? "")
      void retryLoad(pluginWebLoadErrorMessage(0, description))
    })
    el.addEventListener("ipc-message", (event: any) => {
      void onPageMessage(event)
    })

    hostEl.appendChild(el)
    current = el
    bridge = createBridge(el)
    scheduleRefresh(prepared.expiresAt)
    el.setAttribute("src", prepared.url)
  }

  onMount(() => {
    mounted = true
    void mount()
    const observer = new MutationObserver(() => pushTheme())
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color-scheme", "data-theme"],
    })
    onCleanup(() => {
      observer.disconnect()
      teardown()
    })
  })

  // Revision / gateway / binding changes rebuild the webview; the first run is
  // owned by onMount.
  createEffect(
    on(
      () => `${webSurfaceBindingKey(props.view, props.projectDir, props.sessionID)}\u0000${props.gatewayUrl}`,
      () => {
        if (!mounted) return
        void mount()
      },
      { defer: true },
    ),
  )

  // Project/global surfaces (and `reloadOnSessionChange: false` session
  // surfaces) keep their page: they only learn about the new context.
  let lastContext = ""
  createEffect(
    on(
      () => `${props.projectDir}\u0000${props.sessionID ?? ""}`,
      (context) => {
        if (!mounted || context === lastContext) return
        lastContext = context
        if (webSurfaceBindsSession(props.view)) return
        pushContext()
      },
      { defer: true },
    ),
  )

  return (
    <div class="mafw-plugin-web">
      <Show when={error()}>
        {(message) => (
          <DockBanner
            kind="error"
            text={message()}
            action={{
              label: "重试",
              onClick: () => {
                retryUsed = false
                void mount()
              },
            }}
          />
        )}
      </Show>
      <Show when={loading() && !error()}>
        <div class="mafw-plugin-web-loading">
          <LoaderV2 width={16} height={16} />
        </div>
      </Show>
      <div
        class="mafw-plugin-web-host"
        ref={(el) => {
          hostEl = el
        }}
      />
    </div>
  )
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  const text = String(err ?? "")
  return text.length > 0 ? text : "unknown error"
}
