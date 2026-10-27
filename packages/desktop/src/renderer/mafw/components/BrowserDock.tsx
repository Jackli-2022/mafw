// BrowserDock：工作台内嵌浏览器（webview，spec §4）。
// 安全基线全部在 main（browser-session.ts）：权限全拒、非 http(s) 导航拦截、
// window.open 转 dock 内导航、will-attach-webview 加固。这里只做 UI + 导航状态。
// 骨架（spec 2026-10-26）：DockPanelHeader 统一头（标题=页面标题）+ 常驻错误条 +
// 主题化空态；webview 懒挂载（首次真实导航才创建，不再预建 about:blank）。
import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { Icon } from "@mafw/ui/icon"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { BROWSER_PARTITION, navigationDecision, normalizeAddress } from "../../../shared/browser-policy"
import { displayMafwFilePath } from "../../../shared/mafw-file"
import { browserNavRequest } from "../browser-nav"
import { DockBanner, DockEmpty, DockPanelHeader } from "./dock-panel"
import { buildPickCancelScript, buildPickScript, PICK_TIMEOUT_MS, type ElementPickPayload } from "../browser/element-pick"
import { navigationPlan } from "../browser/navigation-plan"
import { getPendingCaptures, captureAttachmentName } from "../chat/pending-captures"
import { clampRect } from "../capture/crop-math"
import { dataUrlToFile } from "../capture/data-url"
import { pushCaptureFile } from "../capture/attach-sink"

export function BrowserDock(props: { sessionID: string | null }) {
  const [address, setAddress] = createSignal("")
  const [title, setTitle] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [canBack, setCanBack] = createSignal(false)
  const [canForward, setCanForward] = createSignal(false)
  const [failed, setFailed] = createSignal<string | null>(null)
  const [started, setStarted] = createSignal(false)
  const [picking, setPicking] = createSignal(false)

  let host: HTMLDivElement | undefined
  let view: any = null

  const sync = () => {
    if (!view) return
    try {
      const url = String(view.getURL?.() ?? "")
      if (url) { setAddress(url); setStarted(true) }
      setCanBack(!!view.canGoBack?.())
      setCanForward(!!view.canGoForward?.())
      setTitle(String(view.getTitle?.() ?? ""))
    } catch { /* 未 attach 时方法不可用 */ }
  }

  /** 首次真实导航才创建 webview（懒挂载）；已有 view 时必须走 loadURL。 */
  const ensureView = (url: string): void => {
    const plan = navigationPlan(!!view)
    if (!plan.create) {
      try { view?.loadURL?.(url) } catch { /* 下一帧由用户重试 */ }
      return
    }
    if (!host) return
    // 用 createElement 而非 JSX：webview 是 Electron 自定义元素，JSX 类型面不认。
    const el = document.createElement("webview") as any
    el.setAttribute("partition", BROWSER_PARTITION)
    el.className = "mafw-browser-view"
    el.addEventListener("did-navigate", sync)
    el.addEventListener("did-navigate-in-page", sync)
    el.addEventListener("did-start-loading", () => { setLoading(true); setFailed(null) })
    el.addEventListener("did-stop-loading", () => { setLoading(false); sync() })
    el.addEventListener("page-title-updated", (e: any) => setTitle(String(e?.title ?? "")))
    el.addEventListener("dom-ready", sync)
    el.addEventListener("did-fail-load", (e: any) => {
      if (e?.errorCode === -3 || !e?.isMainFrame) return
      setFailed(`加载失败：${String(e?.errorDescription ?? e?.errorCode ?? "unknown")}`)
    })
    host.appendChild(el)
    view = el
    // src 属性导航：webview 尚未 attach 时 loadURL 会抛「must be attached」，src 会被排队。
    try { el.setAttribute("src", url) } catch { /* ignore */ }
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
    ensureView(url)
  }

  const retry = () => {
    if (address()) load(address())
    else try { view?.reload?.() } catch { /* ignore */ }
  }

  // renderer 内部导航请求（文件预览：html → 浏览器 surface，2026-10-27）
  createEffect(() => {
    const req = browserNavRequest()
    if (!req) return
    load(req.url)
  })

  /** 本地文件（mafw-file://）地址栏友好显示：📄 rel；远程 URL 原样。系统浏览器按钮对本地文件不适用。 */
  const localFilePath = () => displayMafwFilePath(address())
  const displayAddress = () => {
    const rel = localFilePath()
    return rel ? `📄 ${rel}` : address()
  }
  const isRemote = () => !localFilePath()

  /** G2：点选元素 → 元素信息 + 区域截图 → capture 草稿（+ 图片进媒体管道）。 */
  let pickToken = 0
  const cancelPick = () => {
    pickToken++
    setPicking(false)
    try { void view?.executeJavaScript?.(buildPickCancelScript()) } catch { /* ignore */ }
  }
  // app 级 Esc 取消（页面侧 Esc 收不到时兜底）；捕获阶段阻断其他 Esc 处理
  createEffect(() => {
    if (!picking()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      cancelPick()
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })
  const startPick = async () => {
    if (!view || picking()) return
    const token = ++pickToken
    setPicking(true)
    const timer = setTimeout(() => { if (token === pickToken) cancelPick() }, PICK_TIMEOUT_MS)
    try {
      const payload = (await view.executeJavaScript(buildPickScript(), true)) as ElementPickPayload | null
      if (token !== pickToken) return // 已取消/超时
      if (!payload) return
      let shot = ""
      if (payload.rect && view.clientWidth > 0 && view.clientHeight > 0) {
        const rr = clampRect(payload.rect, { x: 0, y: 0, width: view.clientWidth, height: view.clientHeight })
        if (rr.width > 0 && rr.height > 0) {
          try {
            // capturePage 在本机 Electron 42 对 guest 悬挂（UnknownVizError）→ 用窗口区域截屏
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
          .then((f) => pushCaptureFile(f))
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
    const off = window.api.browser.onOpenUrl((url) => load(url))
    onCleanup(() => {
      off()
      try { view?.remove?.() } catch { /* ignore */ }
      view = null
    })
  })

  return (
    <div class="mafw-browser-dock">
      <DockPanelHeader title={title() || "浏览器"}>
        <TooltipV2 value="后退" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" disabled={!canBack()} aria-label="后退" onClick={() => { try { view?.goBack?.() } catch { /* ignore */ } }}>
            <Icon name="arrow-left" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="前进" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" disabled={!canForward()} aria-label="前进" onClick={() => { try { view?.goForward?.() } catch { /* ignore */ } }}>
            <Icon name="arrow-right" size="small" />
          </ButtonV2>
        </TooltipV2>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" aria-label="刷新" disabled={!started()} onClick={retry}>
            <Icon name="refresh" size="small" />
          </ButtonV2>
        </TooltipV2>
        <Show when={loading()}>
          <LoaderV2 width={14} height={14} />
        </Show>
        <TooltipV2 value="点选元素（点击后捕获元素信息 + 截图）" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            aria-label="点选元素"
            aria-pressed={picking()}
            disabled={!started() || picking()}
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
            disabled={!started() || !isRemote()}
            onClick={() => { const url = address(); if (url) void window.api.browser.openExternal(url) }}
          >
            <Icon name="square-arrow-top-right" size="small" />
          </ButtonV2>
        </TooltipV2>
      </DockPanelHeader>
      <div class="mafw-browser-bar">
        <TextInputV2
          class="mafw-browser-address"
          value={displayAddress()}
          placeholder="输入网址（Enter 打开）"
          onInput={(e) => setAddress(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); load(address()) } }}
        />
      </div>
      <Show when={failed()}>
        <DockBanner kind="error" text={failed()!} action={{ label: "重试", onClick: retry }} />
      </Show>
      <Show when={!started() && !failed()}>
        <DockEmpty icon="globe" text="输入网址开始浏览" hint="Enter 打开；会话内链接会在此面板打开" />
      </Show>
      <div class="mafw-browser-host" ref={(el) => { host = el }} />
    </div>
  )
}
