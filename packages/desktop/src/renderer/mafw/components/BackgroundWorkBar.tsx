// composer 上方 work bar（spec §6.1）：后台任务存在感层。
// - 空态整条不渲染（零占位）；
// - 有运行中任务：⏳ 后台 N · <最近任务>，点击打开 RightDock「后台」tab；
// - 前台 blocking：runtime=opencode 即显示检测（Ruling A 核心面）；按钮仅在
//   REST 可用时出现（不误给死按钮）；
// - 完成短闪来自 store 终态回调（仅当前会话、非 cancelled/probe/水合），5s 卸载。
import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { backgroundRows, onBackgroundTerminal } from "../background-store"
import { rowsForSession, type BackgroundRow } from "../background-tracker"
import { findBlockingWork } from "../background-detect"
import { workspace } from "../workspace/session-workspace"
import { backgroundRestState, probeBackgroundRest, canUseBackgroundApi, shouldShowRestUnavailableHint, type BackgroundRestState } from "../background-capability"

export function BackgroundWorkBar(props: { sessionID: string; onOpenDock: () => void }) {
  const [restState, setRestState] = createSignal<BackgroundRestState>(backgroundRestState())
  const [opencodeOk, setOpencodeOk] = createSignal(false)
  const [flash, setFlash] = createSignal<string | null>(null)
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  const rows = () => rowsForSession(backgroundRows(), props.sessionID)
  const running = () => rows().filter((r: BackgroundRow) => r.status === "running")
  const store = workspace.store
  const blocking = () => findBlockingWork(store.message[props.sessionID] || [], store.part)

  createEffect(() => { void probeBackgroundRest().then(setRestState) })
  createEffect(() => { void canUseBackgroundApi().then(setOpencodeOk) })
  createEffect(() => {
    if (!rows().some(r => r.type === "shell") && blocking().length === 0) return
    const t = setInterval(() => { void probeBackgroundRest().then(setRestState) }, 60_000)
    onCleanup(() => clearInterval(t))
  })

  onMount(() => {
    const off = onBackgroundTerminal((row) => {
      if (row.sessionID !== props.sessionID || row.status === "cancelled") return
      if (flashTimer) clearTimeout(flashTimer)
      setFlash(`${row.status === "failed" ? "❌" : "✅"} ${row.label || row.id}`)
      flashTimer = setTimeout(() => setFlash(null), 5000)
    })
    onCleanup(() => {
      off()
      if (flashTimer) clearTimeout(flashTimer)
    })
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
    <Show when={running().length > 0 || (blocking().length > 0 && opencodeOk()) || (running().length === 0 && blocking().length === 0 && flash())}>
      <div class="mafw-bg-bar">
        <Show when={running().length > 0}>
          <div
            class="mafw-bg-bar-row"
            role="button"
            tabIndex={0}
            onClick={() => props.onOpenDock()}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpenDock() } }}
          >
            <span class="mafw-bg-bar-count">⏳ 后台 {running().length}</span>
            <span class="mafw-bg-bar-label">{running()[0]?.label || running()[0]?.id}</span>
            <span class="mafw-bg-bar-chevron">›</span>
          </div>
        </Show>
        <Show when={blocking().length > 0 && opencodeOk()}>
          <div class="mafw-bg-bar-row mafw-bg-bar-blocking">
            <span class="mafw-bg-bar-count">⏳ 前台运行中</span>
            <span class="mafw-bg-bar-label">{blocking()[0]?.label || "任务"}</span>
            <Show when={restState() === "available"}>
              <ButtonV2 variant="ghost" size="small" onClick={() => void backgroundAll()}>全部转后台</ButtonV2>
            </Show>
            <Show when={shouldShowRestUnavailableHint(restState(), blocking().length > 0)}>
              <span class="mafw-bg-bar-rest-hint">REST 未就绪，转后台暂不可用</span>
            </Show>
          </div>
        </Show>
        <Show when={running().length === 0 && blocking().length === 0 && flash()}>
          <div class="mafw-bg-bar-row mafw-bg-bar-flash">
            <span class="mafw-bg-bar-label">{flash()}</span>
          </div>
        </Show>
      </div>
    </Show>
  )
}
