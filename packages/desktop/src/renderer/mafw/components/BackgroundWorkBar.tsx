// composer 上方 work bar：后台任务存在感层。
// - 空态整条不渲染（零占位）；
// - 有运行中作业：⏳ 后台 N · <最近任务>，点击打开右工作台「执行 › 后台」；
// - 前台 blocking：由 `session.background` 动作决定是否给「全部转后台」按钮
//   （死按钮不渲染）；
// - 完成短闪来自 jobs store 的终态回调（仅当前会话、runtime-shell、非 cancelled）。
import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { backgroundJobs, onBackgroundTerminal } from "../background-store"
import { jobLabel, jobsForSession, type BackgroundJob } from "../background-jobs"
import { findBlockingWork } from "../background-detect"
import { workspace } from "../workspace/session-workspace"
import { canUseBackgroundApi } from "../background-capability"

export function BackgroundWorkBar(props: { sessionID: string; onOpenDock: () => void }) {
  const [canBackground, setCanBackground] = createSignal(false)
  const [flash, setFlash] = createSignal<string | null>(null)
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  const jobs = () => jobsForSession(backgroundJobs(), props.sessionID)
  const running = () => jobs().filter((j) => j.status === "running" || j.status === "input_required")
  const store = workspace.store
  const blocking = () => findBlockingWork(store.message[props.sessionID] || [], store.part)

  createEffect(() => { void canUseBackgroundApi().then(setCanBackground) })

  onMount(() => {
    const off = onBackgroundTerminal((job: BackgroundJob) => {
      if (job.sessionID !== props.sessionID) return
      if (job.source !== "runtime-shell" || job.kind !== "shell") return
      if (job.status === "cancelled") return
      if (flashTimer) clearTimeout(flashTimer)
      setFlash(`${job.status === "failed" ? "❌" : "✅"} ${jobLabel(job)}`)
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
    <Show when={running().length > 0 || (blocking().length > 0 && canBackground()) || (running().length === 0 && blocking().length === 0 && flash())}>
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
            <span class="mafw-bg-bar-label">{jobLabel(running()[0]!)}</span>
            <span class="mafw-bg-bar-chevron">›</span>
          </div>
        </Show>
        <Show when={blocking().length > 0 && canBackground()}>
          <div class="mafw-bg-bar-row mafw-bg-bar-blocking">
            <span class="mafw-bg-bar-count">⏳ 前台运行中</span>
            <span class="mafw-bg-bar-label">{blocking()[0]?.label || "任务"}</span>
            <ButtonV2 variant="ghost" size="small" onClick={() => void backgroundAll()}>全部转后台</ButtonV2>
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
