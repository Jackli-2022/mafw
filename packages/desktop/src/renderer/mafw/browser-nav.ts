// renderer 侧浏览器导航请求（MafwShell → BrowserDock，2026-10-27 文件预览）。
// 与既有 browser-open-url（main → preload → BrowserDock 直连）互补：这条是 renderer 内部流程。
import { createSignal } from "solid-js"

export type BrowserNavRequest = { url: string; newTab: boolean; at: number }

const [browserNav, setBrowserNav] = createSignal<BrowserNavRequest | null>(null)

export function requestBrowserNavigate(url: string, opts: { newTab?: boolean } = {}): void {
  setBrowserNav({ url, newTab: opts.newTab === true, at: Date.now() })
}

export function browserNavRequest(): BrowserNavRequest | null {
  return browserNav()
}

/** Consume the pending request once so remounting BrowserDock does not replay it. */
export function takeBrowserNavRequest(): BrowserNavRequest | null {
  const req = browserNav()
  if (req) setBrowserNav(null)
  return req
}
