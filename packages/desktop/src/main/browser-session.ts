// 浏览器 guest 的 main 侧加固：权限全拒、window.open 转 dock 内导航、非 http(s) 导航拦截、
// will-attach-webview 强制安全基线。渲染层只负责 UI；决策纯函数在 browser-policy.ts。
//
// 插件 Web 页面的 guest 走另一套 window.open 规则（plugin-web-session.ts）：
// 永远拒绝弹窗，http(s)/mailto/tel 交给系统浏览器，绝不进工作台浏览器 dock
// （dock 有自己的分区与 guest 策略，插件页不该借道进入）。
import { app, BrowserWindow, session, shell, type WebContents } from "electron"
import { BROWSER_PARTITION, guestAttachAllowed, navigationDecision, windowOpenDecision } from "../shared/browser-policy"
import {
  isPluginWebSession,
  pluginWebPartitionPackage,
  pluginWebWindowOpenAction,
} from "./plugin-web-session"

let configured = false

function hardenGuest(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    // `contents.session` is read at call time: the guest session is attached
    // when the webview is created, not guaranteed when this handler is wired.
    if (isPluginWebSession(contents.session)) {
      const pluginDecision = pluginWebWindowOpenAction(url)
      if (pluginDecision.action === "external") void shell.openExternal(pluginDecision.url)
      return { action: "deny" }
    }
    const decision = windowOpenDecision(url)
    if (decision.action === "navigate") {
      const host = contents.hostWebContents ?? BrowserWindow.getFocusedWindow()?.webContents
      if (host && !host.isDestroyed()) host.send("browser-open-url", { url: decision.url, newTab: true })
    } else if (decision.action === "external") {
      void shell.openExternal(decision.url)
    }
    return { action: "deny" }
  })

  contents.on("will-navigate", (event, url) => {
    const decision = navigationDecision(url)
    if (decision === "allow") return
    event.preventDefault()
    if (decision === "external") void shell.openExternal(url)
  })
}

/** 应用级一次性装配（幂等）：partition 权限全拒 + guest webContents 加固。 */
export function configureBrowserSession() {
  if (configured) return
  configured = true

  const ses = session.fromPartition(BROWSER_PARTITION)
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)

  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return
    hardenGuest(contents)

    contents.on("context-menu", (event, params) => {
      event.preventDefault()
      let canGoBack = false
      let canGoForward = false
      try {
        canGoBack = contents.navigationHistory.canGoBack()
        canGoForward = contents.navigationHistory.canGoForward()
      } catch {
        /* navigation history unavailable */
      }
      contents.hostWebContents?.send("browser-context-menu", {
        url: contents.getURL(),
        linkURL: params.linkURL || undefined,
        selectionText: params.selectionText || undefined,
        imageURL: params.mediaType === "image" ? params.srcURL || undefined : undefined,
        isEditable: params.isEditable,
        x: params.x,
        y: params.y,
        canGoBack,
        canGoForward,
        webContentsId: contents.id,
      })
    })
  })
}

/** 宿主窗口加固：webview 挂载前清掉 preload/node 能力、锁 partition、拒绝危险 src。 */
export function wireWebviewAttach(host: WebContents) {
  host.on("will-attach-webview", (event, webPreferences, params) => {
    const pluginPartition = pluginWebPartitionPackage(params.partition) !== null
    // Plugin web surfaces own their partition, preload and request filter
    // (main/plugin-web-session.ts): never strip that preload and never veto the
    // partition here, but keep the node-capability baseline below as
    // defense-in-depth (either listener may run first).
    if (!pluginPartition) delete (webPreferences as { preload?: string }).preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    if (pluginPartition) return
    if (params.partition !== BROWSER_PARTITION) {
      event.preventDefault()
      return
    }
    if (!guestAttachAllowed(params.src)) event.preventDefault()
  })
}
