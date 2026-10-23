// 浏览器 guest 的 main 侧加固：权限全拒、window.open 转 dock 内导航、非 http(s) 导航拦截、
// will-attach-webview 强制安全基线。渲染层只负责 UI；决策纯函数在 browser-policy.ts。
import { app, BrowserWindow, session, shell, type WebContents } from "electron"
import { BROWSER_PARTITION, guestAttachAllowed, navigationDecision, windowOpenDecision } from "../shared/browser-policy"

let configured = false

function hardenGuest(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = windowOpenDecision(url)
    if (decision.action === "navigate") {
      const host = contents.hostWebContents ?? BrowserWindow.getFocusedWindow()?.webContents
      if (host && !host.isDestroyed()) host.send("browser-open-url", decision.url)
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
    if (contents.getType() === "webview") hardenGuest(contents)
  })
}

/** 宿主窗口加固：webview 挂载前清掉 preload/node 能力、锁 partition、拒绝危险 src。 */
export function wireWebviewAttach(host: WebContents) {
  host.on("will-attach-webview", (event, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    if (params.partition !== BROWSER_PARTITION) {
      event.preventDefault()
      return
    }
    if (!guestAttachAllowed(params.src)) event.preventDefault()
  })
}
