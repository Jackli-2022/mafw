// renderer 内部浏览器导航请求（文件预览 / MafwShell 外链路由写入，BrowserDock 消费）。
// 与 browser-open-url（main → preload → MafwShell）互补：这条不经过 main。
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
