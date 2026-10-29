// BrowserDock：工作台内嵌浏览器（webview，spec 2026-10-29 multi-tab）。
// 安全基线全部在 main（browser-session.ts）：权限全拒、非 http(s) 导航拦截、
// window.open 转 dock 内导航、will-attach-webview 加固。这里只做 UI + tab 状态。
// 每个 tab 一个常挂载 webview；非活动 tab 只 display:none，不销毁页面状态。
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { TabsV2 } from "@mafw/ui/v2/tabs-v2"
import { Icon } from "@mafw/ui/icon"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { menuController } from "../context-menu/controller"
import { buildBrowserMenu } from "../context-menu/builders/browser"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { BROWSER_PARTITION, navigationDecision, normalizeAddress } from "../../../shared/browser-policy"
import { displayMafwFilePath } from "../../../shared/mafw-file"
import { takeBrowserNavRequest } from "../browser-nav"
import {
  activeBrowserTabId,
  browserTabTitle,
  browserTabs,
  closeBrowserTab,
  openBrowserTab,
  setActiveBrowserTab,
  updateBrowserTab,
  type BrowserTab,
} from "../browser-tabs"
import { DockBanner, DockEmpty } from "./dock-panel"
import { buildPickCancelScript, buildPickScript, PICK_TIMEOUT_MS, type ElementPickPayload } from "../browser/element-pick"
import { getPendingCaptures, captureAttachmentName } from "../chat/pending-captures"
import { clampRect } from "../capture/crop-math"
import { dataUrlToFile } from "../capture/data-url"
import { pushCaptureFile } from "../capture/attach-sink"

export function BrowserDock(props: { sessionID: string | null }) {
  const [addressDraft, setAddressDraft] = createSignal("")
  const [picking, setPicking] = createSignal(false)
  const views = new Map<string, any>()
  const viewUrls = new Map<string, string>()
  const paneEls = new Map<string, HTMLDivElement>()
  let host: HTMLDivElement | undefined

  const tabs = () => browserTabs()
  const activeTab = (): BrowserTab | null => tabs().find((tab) => tab.id === activeBrowserTabId()) ?? null
  const activeView = () => {
    const id = activeBrowserTabId()
    return id ? views.get(id) ?? null : null
  }
  const displayAddress = (url: string) => displayMafwFilePath(url) ?? url
  const isRemote = () => {
    const url = activeTab()?.url ?? ""
    return !!url && !displayMafwFilePath(url)
  }

  let addressTabId: string | null = null
  let addressUrl = ""
  createEffect(() => {
    const id = activeBrowserTabId()
    const tab = tabs().find((item) => item.id === id)
    const url = tab?.url ?? ""
    if (id === addressTabId && url === addressUrl) return
    addressTabId = id
    addressUrl = url
    setAddressDraft(displayAddress(url))
  })

  const removeView = (id: string) => {
    const view = views.get(id)
    try { view?.remove?.() } catch { /* ignore */ }
    views.delete(id)
    viewUrls.delete(id)
    paneEls.get(id)?.remove()
    paneEls.delete(id)
  }

  const sync = (id: string, view: any) => {
    try {
      const url = String(view.getURL?.() ?? "")
      if (url) {
        viewUrls.set(id, url)
        updateBrowserTab(id, { url })
      }
      updateBrowserTab(id, {
        canBack: !!view.canGoBack?.(),
        canForward: !!view.canGoForward?.(),
        title: String(view.getTitle?.() ?? ""),
      })
    } catch { /* 未 attach 时方法不可用 */ }
  }

  const createView = (tab: BrowserTab, pane: HTMLDivElement) => {
    // 用 createElement 而非 JSX：webview 是 Electron 自定义元素，JSX 类型面不认。
    const el = document.createElement("webview") as any
    el.setAttribute("partition", BROWSER_PARTITION)
    el.setAttribute("plugins", "")
    el.className = "mafw-browser-view"
    el.addEventListener("did-navigate", () => sync(tab.id, el))
    el.addEventListener("did-navigate-in-page", () => sync(tab.id, el))
    el.addEventListener("did-start-loading", () => updateBrowserTab(tab.id, { loading: true, failed: undefined }))
    el.addEventListener("did-stop-loading", () => {
      updateBrowserTab(tab.id, { loading: false })
      sync(tab.id, el)
    })
    el.addEventListener("page-title-updated", (event: any) => updateBrowserTab(tab.id, { title: String(event?.title ?? "") }))
    el.addEventListener("dom-ready", () => sync(tab.id, el))
    el.addEventListener("did-fail-load", (event: any) => {
      if (event?.errorCode === -3 || !event?.isMainFrame) return
      updateBrowserTab(tab.id, {
        failed: `加载失败：${String(event?.errorDescription ?? event?.errorCode ?? "unknown")}`,
      })
    })
    pane.appendChild(el)
    views.set(tab.id, el)
    viewUrls.set(tab.id, tab.url)
    try { el.setAttribute("src", tab.url) } catch { /* ignore */ }
  }

  const ensurePanes = () => {
    if (!host) return
    const ids = new Set(tabs().map((tab) => tab.id))
    for (const id of [...views.keys()]) if (!ids.has(id)) removeView(id)
    for (const [id, pane] of [...paneEls.entries()]) {
      if (!ids.has(id)) {
        pane.remove()
        paneEls.delete(id)
      }
    }
    for (const tab of tabs()) {
      let pane = paneEls.get(tab.id)
      if (!pane) {
        pane = document.createElement("div")
        pane.className = "mafw-browser-tab-pane"
        host.appendChild(pane)
        paneEls.set(tab.id, pane)
      }
      pane.classList.toggle("is-active", tab.id === activeBrowserTabId())
      const view = views.get(tab.id)
      if (!view && tab.url) {
        createView(tab, pane)
      } else if (view && tab.url && viewUrls.get(tab.id) !== tab.url) {
        viewUrls.set(tab.id, tab.url)
        try { view.loadURL?.(tab.url) } catch { /* 下一帧由用户重试 */ }
      }
    }
  }

  createEffect(() => {
    tabs()
    activeBrowserTabId()
    ensurePanes()
  })

  const load = (raw: string, opts: { newTab?: boolean } = {}) => {
    const url = normalizeAddress(raw)
    if (!url) return
    const decision = navigationDecision(url)
    if (decision === "external") { void window.api.browser.openExternal(url); return }
    if (decision !== "allow") return
    const newTab = opts.newTab === true || !activeBrowserTabId()
    const tab = openBrowserTab(url, { newTab })
    if (!tab) {
      showToastV2({ description: "最多同时打开 12 个浏览器标签", duration: 2200 } as any)
      return
    }
    setAddressDraft(displayAddress(url))
    queueMicrotask(() => {
      const view = views.get(tab.id)
      try { view?.focus?.() } catch { /* ignore */ }
    })
  }

  const retry = () => {
    const view = activeView()
    if (view) { try { view.reload?.(); return } catch { /* ignore */ } }
    const tab = activeTab()
    if (tab?.url) load(tab.url, { newTab: false })
  }

  const closeTab = (id: string) => {
    removeView(id)
    closeBrowserTab(id)
  }

  const newBlankTab = () => {
    const tab = openBrowserTab("", { newTab: true })
    if (!tab) showToastV2({ description: "最多同时打开 12 个浏览器标签", duration: 2200 } as any)
  }

  const navigateBack = () => { const view = activeView(); try { view?.goBack?.() } catch { /* ignore */ } }
  const navigateForward = () => { const view = activeView(); try { view?.goForward?.() } catch { /* ignore */ } }

  // renderer 内部导航请求（文件预览 html / 外部链接）：newTab 由 shell 决定。
  createEffect(() => {
    const req = takeBrowserNavRequest()
    if (req) load(req.url, { newTab: req.newTab })
  })

  /** G2：点选元素 → 元素信息 + 区域截图 → capture 草稿（+ 图片进媒体管道）。 */
  let pickToken = 0
  const cancelPick = () => {
    pickToken++
    setPicking(false)
    try { void activeView()?.executeJavaScript?.(buildPickCancelScript()) } catch { /* ignore */ }
  }
  createEffect(() => {
    if (!picking()) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      cancelPick()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  const startPick = async () => {
    const view = activeView()
    if (!view || picking()) return
    const tab = activeTab()
    if (!tab) return
    const token = ++pickToken
    setPicking(true)
    const timer = setTimeout(() => { if (token === pickToken) cancelPick() }, PICK_TIMEOUT_MS)
    try {
      const payload = (await view.executeJavaScript(buildPickScript(), true)) as ElementPickPayload | null
      if (token !== pickToken) return
      if (!payload) return
      let shot = ""
      if (payload.rect && view.clientWidth > 0 && view.clientHeight > 0) {
        const rr = clampRect(payload.rect, { x: 0, y: 0, width: view.clientWidth, height: view.clientHeight })
        if (rr.width > 0 && rr.height > 0) {
          try {
            const box = view.getBoundingClientRect()
            const cap = await window.api.capture.windowRegion({
              x: box.left + rr.x,
              y: box.top + rr.y,
              width: rr.width,
              height: rr.height,
            })
            shot = cap?.dataUrl ?? ""
          } catch { /* 截图失败：仅元素信息 */ }
        }
      }
      if (!props.sessionID) {
        showToastV2({ description: "先打开一个会话再点选元素", variant: "error", duration: 2500 } as any)
        return
      }
      const item = getPendingCaptures().add({
        sessionID: props.sessionID,
        kind: "element",
        comment: "",
        dataUrl: shot,
        meta: {
          tag: payload.tag,
          selector: payload.selector,
          text: payload.text,
          rect: payload.rect,
          outerHTML: payload.outerHTML,
          attrs: payload.attrs,
        },
      })
      if (shot) {
        void dataUrlToFile(shot, captureAttachmentName(item.id))
          .then((file) => pushCaptureFile(file))
          .catch(() => { /* 保留 pending 草稿 */ })
      }
    } catch {
      if (token === pickToken) showToastV2({ description: "页面不支持点选（可能被 CSP 限制）", variant: "error", duration: 3000 } as any)
    } finally {
      clearTimeout(timer)
      if (token === pickToken) setPicking(false)
    }
  }

  onMount(() => {
    ensurePanes()
    onCleanup(() => {
      for (const id of [...views.keys()]) removeView(id)
    })
  })

  return (
    <div
      class="mafw-browser-dock"
      onContextMenu={(event) => {
        if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
        event.preventDefault()
        const tab = activeTab()
        const url = tab?.url ?? ""
        menuController.request(
          buildBrowserMenu,
          {
            url,
            canBack: tab?.canBack === true,
            canForward: tab?.canForward === true,
            started: !!activeView(),
            canPick: !!activeView() && !picking(),
          },
          (id) => {
            if (id === "browser.back") navigateBack()
            else if (id === "browser.forward") navigateForward()
            else if (id === "browser.reload") retry()
            else if (id === "browser.copyLink") { if (url) void navigator.clipboard.writeText(url) }
            else if (id === "browser.openExternal") { if (url) void window.api.browser.openExternal(url) }
            else if (id === "browser.pick") void startPick()
          },
          { point: { x: event.clientX, y: event.clientY } },
        )
      }}
    >
      <div class="mafw-browser-tabbar">
        <Show when={tabs().length > 0}>
          <TabsV2
            variant="pill"
            value={activeBrowserTabId() ?? ""}
            onValueChange={(value: string) => { if (value) setActiveBrowserTab(String(value)) }}
          >
            <TabsV2.List class="mafw-browser-tabs" aria-label="浏览器标签">
              <For each={tabs()}>
                {(tab) => (
                  <TabsV2.Trigger value={tab.id} onMiddleClick={() => closeTab(tab.id)}>
                    <Icon name="globe" size="small" />
                    <span class="mafw-browser-tab-title">{browserTabTitle(tab)}</span>
                    <TabsV2.CloseButton onClick={() => closeTab(tab.id)} />
                  </TabsV2.Trigger>
                )}
              </For>
            </TabsV2.List>
          </TabsV2>
        </Show>
        <ButtonV2 variant="ghost" size="small" class="mafw-browser-new-tab" aria-label="新建浏览器标签" onClick={newBlankTab}>
          <Icon name="plus" size="small" />
        </ButtonV2>
      </div>

      <div class="mafw-browser-bar">
        <TooltipV2 value="后退" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" disabled={activeTab()?.canBack !== true} aria-label="后退" onClick={navigateBack}>
            <Icon name="arrow-left" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="前进" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" disabled={activeTab()?.canForward !== true} aria-label="前进" onClick={navigateForward}>
            <Icon name="arrow-right" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" aria-label="刷新" disabled={!activeView()} onClick={retry}>
            <Icon name="refresh" size="small" />
          </ButtonV2>
        </TooltipV2>
        <Show when={activeTab()?.loading}>
          <LoaderV2 width={14} height={14} />
        </Show>
        <TextInputV2
          class="mafw-browser-address"
          value={addressDraft()}
          placeholder="输入网址（Enter 打开）"
          onInput={(event) => setAddressDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            load(addressDraft(), { newTab: false })
          }}
        />
        <TooltipV2 value="点选元素（点击后捕获元素信息 + 截图）" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="点选元素"
            aria-pressed={picking()}
            disabled={!activeView() || picking()}
            onClick={() => void startPick()}
          >
            <Icon name="selector" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="在系统浏览器打开" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="在系统浏览器打开"
            disabled={!isRemote()}
            onClick={() => { const url = activeTab()?.url; if (url) void window.api.browser.openExternal(url) }}
          >
            <Icon name="square-arrow-top-right" size="small" />
          </ButtonV2>
        </TooltipV2>
      </div>

      <Show when={activeTab()?.failed}>
        {(failed) => <DockBanner kind="error" text={failed()} action={{ label: "重试", onClick: retry }} />}
      </Show>
      <Show when={tabs().length === 0}>
        <DockEmpty icon="globe" text="输入网址开始浏览" hint="Enter 打开；聊天里的链接会新开 tab" />
      </Show>
      <div class="mafw-browser-host" ref={(el) => { host = el }} />
    </div>
  )
}
