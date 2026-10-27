// renderer 侧浏览器导航请求（MafwShell → BrowserDock，2026-10-27 文件预览）。
// 与既有 browser-open-url（main → preload → BrowserDock 直连）互补：这条是 renderer 内部流程。
import { createSignal } from "solid-js"

export type BrowserNavRequest = { url: string; at: number }

const [browserNav, setBrowserNav] = createSignal<BrowserNavRequest | null>(null)

export function requestBrowserNavigate(url: string): void {
  setBrowserNav({ url, at: Date.now() })
}

export function browserNavRequest(): BrowserNavRequest | null {
  return browserNav()
}
