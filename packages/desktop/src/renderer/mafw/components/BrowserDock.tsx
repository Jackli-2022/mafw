// BrowserDock：RightDock「浏览」tab —— 内嵌浏览器（webview 简单版，spec §4）。
// 安全基线全部在 main（browser-session.ts）：权限全拒、非 http(s) 导航拦截、
// window.open 转 dock 内导航、will-attach-webview 加固。这里只做 UI + 导航状态。
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { BROWSER_PARTITION, navigationDecision, normalizeAddress } from "../../../shared/browser-policy"

export function BrowserDock() {
  const [address, setAddress] = createSignal("")
  const [title, setTitle] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [canBack, setCanBack] = createSignal(false)
  const [canForward, setCanForward] = createSignal(false)
  const [failed, setFailed] = createSignal<string | null>(null)
  const [started, setStarted] = createSignal(false)

  let host: HTMLDivElement | undefined
  let view: any = null

  const sync = () => {
    if (!view) return
    try {
      const url = String(view.getURL?.() ?? "")
      if (url && url !== "about:blank") { setAddress(url); setStarted(true) }
      setCanBack(!!view.canGoBack?.())
      setCanForward(!!view.canGoForward?.())
      setTitle(String(view.getTitle?.() ?? ""))
    } catch { /* 未 attach 时方法不可用 */ }
  }

  const load = (raw: string) => {
    const url = normalizeAddress(raw)
    if (!url) return
    const decision = navigationDecision(url)
    if (decision === "external") { void window.api.browser.openExternal(url); return }
    if (decision !== "allow") return
    setFailed(null)
    setAddress(url)
    setStarted(true)
    try { view?.loadURL?.(url) } catch { /* not attached yet */ }
  }

  onMount(() => {
    // 用 createElement 而非 JSX：webview 是 Electron 自定义元素，JSX 类型面不认。
    const el = document.createElement("webview") as any
    el.setAttribute("partition", BROWSER_PARTITION)
    el.setAttribute("src", "about:blank")
    el.className = "mafw-browser-view"
    host?.appendChild(el)
    view = el

    el.addEventListener("did-navigate", sync)
    el.addEventListener("did-navigate-in-page", sync)
    el.addEventListener("did-start-loading", () => setLoading(true))
    el.addEventListener("did-stop-loading", () => { setLoading(false); sync() })
    el.addEventListener("page-title-updated", (e: any) => setTitle(String(e?.title ?? "")))
    el.addEventListener("dom-ready", sync)
    el.addEventListener("did-fail-load", (e: any) => {
      if (e?.errorCode === -3 || !e?.isMainFrame) return
      setFailed(`加载失败：${String(e?.errorDescription ?? e?.errorCode ?? "unknown")}`)
    })

    const off = window.api.browser.onOpenUrl((url) => load(url))
    onCleanup(() => {
      off()
      try { el.remove() } catch { /* ignore */ }
      view = null
    })
  })

  return (
    <div class="mafw-browser-dock">
      <div class="mafw-browser-bar">
        <TooltipV2 value="后退" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" disabled={!canBack()} aria-label="后退" onClick={() => { try { view?.goBack?.() } catch { /* ignore */ } }}>←</ButtonV2>
        </TooltipV2>
        <TooltipV2 value="前进" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" disabled={!canForward()} aria-label="前进" onClick={() => { try { view?.goForward?.() } catch { /* ignore */ } }}>→</ButtonV2>
        </TooltipV2>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" aria-label="刷新" onClick={() => { try { view?.reload?.() } catch { /* ignore */ } }}>⟳</ButtonV2>
        </TooltipV2>
        <TextInputV2
          class="mafw-browser-address"
          value={address()}
          placeholder="输入网址（Enter 打开）"
          onInput={(e) => setAddress(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); load(address()) } }}
        />
        <TooltipV2 value="在系统浏览器打开" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="在系统浏览器打开"
            disabled={!started()}
            onClick={() => { const url = address(); if (url) void window.api.browser.openExternal(url) }}
          >↗</ButtonV2>
        </TooltipV2>
      </div>
      <div class="mafw-browser-status">
        <span class="mafw-browser-title" title={title()}>{loading() ? "加载中…" : title()}</span>
      </div>
      <Show when={failed()}>
        <div class="mafw-browser-error">{failed()}</div>
      </Show>
      <div class="mafw-browser-host" ref={(el) => { host = el }} />
    </div>
  )
}
