// composer 上方 work bar（spec §6.1）：后台任务存在感层。
// - 空态整条不渲染（零占位）；
// - 有运行中任务：⏳ 后台 N · <最近任务>，点击打开 RightDock「后台」tab；
// - 有前台 blocking 且 REST+opencode 可用：「前台运行中」+ 全部转后台（不乐观改态）；
// - 完成瞬间 ✅/❌ 短闪 5s 后卸载（createPresence 语义，reduced-motion 见 CSS）。
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { backgroundRows } from "../background-store"
import { rowsForSession } from "../background-tracker"
import { findBlockingWork } from "../background-detect"
import { workspace } from "../workspace/session-workspace"
import { backgroundRestAvailable, canUseBackgroundApi } from "../background-capability"

export function BackgroundWorkBar(props: { sessionID: string; onOpenDock: () => void }) {
  const [restOk, setRestOk] = createSignal(false)
  const [opencodeOk, setOpencodeOk] = createSignal(false)
  const [flash, setFlash] = createSignal<string | null>(null)

  const rows = () => rowsForSession(backgroundRows(), props.sessionID)
  const running = () => rows().filter(r => r.status === "running")
  const store = workspace.store
  const blocking = () =>
    findBlockingWork(store.message[props.sessionID] || [], store.part)

  createEffect(() => { void backgroundRestAvailable().then(setRestOk) })
  createEffect(() => { void canUseBackgroundApi().then(setOpencodeOk) })

  // 完成短闪：running 计数从 >0 落到 0 时，显示最近一条终态行 5s。
  let wasRunning = false
  createEffect(() => {
    const has = running().length > 0
    if (wasRunning && !has) {
      const last = rows().find(r => r.status !== "running")
      if (last) {
        setFlash(`${last.status === "failed" ? "❌" : "✅"} ${last.label || last.id}`)
        const t = setTimeout(() => setFlash(null), 5000)
        onCleanup(() => clearTimeout(t))
      }
    }
    wasRunning = has
  })

  const backgroundAll = async () => {
    try {
      await window.api.mafw.sessions.background(props.sessionID)
      showToastV2({ description: "已请求转后台（等待事件确认）", duration: 2000 } as any)
    } catch (e: any) {
      showToastV2({ description: `转后台失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  return (
    <Show when={running().length > 0 || (blocking().length > 0 && restOk() && opencodeOk()) || flash()}>
      <div class="mafw-bg-bar">
        <Show when={running().length > 0}>
          <div class="mafw-bg-bar-row" role="button" tabIndex={0} onClick={() => props.onOpenDock()}
               onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpenDock() } }}>
            <span class="mafw-bg-bar-count">⏳ 后台 {running().length}</span>
            <span class="mafw-bg-bar-label">{running()[0]?.label || running()[0]?.id}</span>
            <span class="mafw-bg-bar-chevron">›</span>
          </div>
        </Show>
        <Show when={running().length === 0 && blocking().length > 0 && restOk() && opencodeOk()}>
          <div class="mafw-bg-bar-row mafw-bg-bar-blocking">
            <span class="mafw-bg-bar-count">⏳ 前台运行中</span>
            <span class="mafw-bg-bar-label">{blocking()[0]?.label || "任务"}</span>
            <ButtonV2 variant="ghost" size="small" onClick={() => void backgroundAll()}>全部转后台</ButtonV2>
          </div>
        </Show>
        <Show when={running().length === 0 && flash()}>
          <div class="mafw-bg-bar-row mafw-bg-bar-flash">
            <span class="mafw-bg-bar-label">{flash()}</span>
          </div>
        </Show>
      </div>
    </Show>
  )
}
