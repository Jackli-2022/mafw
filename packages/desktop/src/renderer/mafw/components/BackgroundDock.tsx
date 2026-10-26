// RightDock「后台」面板（spec §6.2）：本会话后台任务列表（shell + 后台子代理）。
// - shell 行：点击展开输出预览（按需拉取**尾部** 4KB）+ 终止
//   （REST 可用时；内联二次确认；成功后本地落 cancelled——spec §5.1）；
// - subagent 行：点击跳子会话（复用 P0-1 的 openSubagentSession）；
// - running 行 1s 计时跳；空态给引导文案。
import { createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { backgroundRows, ingestBackgroundEvent } from "../background-store"
import { rowsForSession, type BackgroundRow, type BgStatus } from "../background-tracker"
import { taskRows, cancelTask } from "../task-store"
import type { TaskEntity } from "@mafw/sdk"
import { formatDuration } from "../goal-timeline"
import { backgroundRestState, probeBackgroundRest, outputPlaceholder, shouldShowRestUnavailableHint, type BackgroundRestState } from "../background-capability"

const STATUS_LABEL: Record<BgStatus, string> = {
  running: "运行中",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
}

const TAIL_BYTES = 4096

const TASK_STATUS_LABEL: Record<TaskEntity["status"], string> = {
  working: "运行中",
  input_required: "等待输入",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
}

export function BackgroundDock(props: {
  activeSessionId: string | null
  /** 当前会话目录（shell REST location-scoped；reviewer Important 5） */
  sessionDirectory?: string | null
  onOpenSession: (id: string) => void
}) {
  const [now, setNow] = createSignal(Date.now())
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [outputs, setOutputs] = createSignal<Record<string, string>>({})
  const [restState, setRestState] = createSignal<BackgroundRestState>(backgroundRestState())
  const [confirming, setConfirming] = createSignal<string | null>(null)
  const [taskExpanded, setTaskExpanded] = createSignal<string | null>(null)
  const [taskOutputs, setTaskOutputs] = createSignal<Record<string, string>>({})
  const [confirmingTask, setConfirmingTask] = createSignal<string | null>(null)

  const rows = () => rowsForSession(backgroundRows(), props.activeSessionId ?? "")
  const tasks = () => taskRows().filter(t => !props.activeSessionId || t.parentSessionID === props.activeSessionId)
  const dir = () => props.sessionDirectory ?? undefined

  createEffect(() => { void probeBackgroundRest().then(setRestState) })
  createEffect(() => {
    if (!rows().some(r => r.type === "shell")) return
    const t = setInterval(() => { void probeBackgroundRest().then(setRestState) }, 60_000)
    onCleanup(() => clearInterval(t))
  })
  createEffect(() => {
    if (!rows().some(r => r.status === "running") && !tasks().some(t => t.status === "working" || t.status === "input_required")) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(t))
  })

  const elapsed = (r: BackgroundRow) =>
    formatDuration(r.status === "running" ? now() - r.startedAt : (r.endedAt ?? r.startedAt) - r.startedAt)

  const toggle = (r: BackgroundRow) => {
    if (r.type === "subagent") { props.onOpenSession(r.id); return }
    setConfirming(null)
    setExpanded(expanded() === r.id ? null : r.id)
  }

  const refreshOutput = async (r: BackgroundRow) => {
    try {
      const first = await window.api.mafw.shells.output(r.id, { directory: dir() })
      let text = first.output
      // 长输出默认返回头部；截断时按 size 再取尾部（reviewer Important 9）
      if (first.truncated === true && typeof first.size === "number") {
        const tail = await window.api.mafw.shells.output(r.id, {
          directory: dir(),
          cursor: Math.max(0, first.size - TAIL_BYTES),
          limit: TAIL_BYTES,
        })
        text = `…（已截断，显示末尾 ${TAIL_BYTES / 1024}KB）\n${tail.output}`
      }
      setOutputs(prev => ({ ...prev, [r.id]: text }))
    } catch (e: any) {
      showToastV2({ description: `读取输出失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  const terminate = async (r: BackgroundRow) => {
    if (confirming() !== r.id) { setConfirming(r.id); return }
    setConfirming(null)
    try {
      await window.api.mafw.shells.remove(r.id, dir())
      // 本地落终态（spec §5.1：不等事件；builder 对 cancelled 静默）
      ingestBackgroundEvent({ kind: "bg-terminal", id: r.id, terminal: "cancelled", source: "user" })
      showToastV2({ description: "已终止后台任务", duration: 2000 } as any)
    } catch (e: any) {
      showToastV2({ description: `终止失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  const toggleTask = async (t: TaskEntity) => {
    if (t.kind === "subagent" && t.childSessionID) {
      props.onOpenSession(t.childSessionID)
      return
    }
    if (t.kind !== "shell") return
    if (taskExpanded() === t.id) {
      setTaskExpanded(null)
      return
    }
    setTaskExpanded(t.id)
    try {
      const out = await window.api.mafw.tasks.output(t.id, { limit: TAIL_BYTES })
      setTaskOutputs(prev => ({ ...prev, [t.id]: out.output || "(无输出)" }))
    } catch (e: any) {
      setTaskOutputs(prev => ({ ...prev, [t.id]: `读取输出失败：${String(e?.message ?? e).slice(0, 120)}` }))
    }
  }

  const terminateTask = async (t: TaskEntity) => {
    if (confirmingTask() !== t.id) {
      setConfirmingTask(t.id)
      return
    }
    setConfirmingTask(null)
    const done = await cancelTask(t.id)
    if (done) showToastV2({ description: "任务已取消", duration: 2000 } as any)
    else showToastV2({ description: "取消任务失败", variant: "error", duration: 3000 } as any)
  }

  return (
    <div class="mafw-bg-dock">
      <div class="mafw-bg-dock-hint">本会话后台任务：shell 可看输出/终止，子代理点击进入子会话。</div>
      <Show when={shouldShowRestUnavailableHint(restState(), rows().some(r => r.type === "shell"))}>
        <div class="mafw-bg-dock-rest-hint">网关未注入 v2 鉴权或 serve 未就绪：输出/终止/全部转后台暂不可用</div>
      </Show>
      <Show when={tasks().length > 0}>
        <div class="mafw-bg-task-section">
          <div class="mafw-bg-dock-hint">网关任务（持久化，跨重启可查）</div>
          <For each={tasks()}>
            {(t) => (
              <div class="mafw-bg-row-wrap">
                <div
                  class={`mafw-bg-row mafw-bg-${t.status === "working" || t.status === "input_required" ? "running" : t.status === "cancelled" ? "cancelled" : t.status === "failed" ? "failed" : "completed"}`}
                  role="button"
                  tabIndex={0}
                  title={t.title}
                  onClick={() => void toggleTask(t)}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggleTask(t) }
                  }}
                >
                  <span class="mafw-bg-kind">{t.kind === "shell" ? "🐚" : "🤖"}</span>
                  <div class="mafw-bg-main">
                    <div class="mafw-bg-title">{t.title}</div>
                    <div class="mafw-bg-meta">
                      <span class={`mafw-bg-status mafw-bg-status-${t.status === "working" || t.status === "input_required" ? "running" : t.status}`}>{TASK_STATUS_LABEL[t.status]}</span>
                      <span>{formatDuration((t.finishedAt ?? now()) - t.createdAt)}</span>
                    </div>
                  </div>
                  <Show when={t.status === "working" || t.status === "input_required"}>
                    <ButtonV2
                      variant="ghost"
                      size="small"
                      onClick={(e: MouseEvent) => { e.stopPropagation(); void terminateTask(t) }}
                    >
                      {confirmingTask() === t.id ? "确认" : "取消"}
                    </ButtonV2>
                  </Show>
                </div>
                <Show when={t.kind === "shell" && taskExpanded() === t.id}>
                  <div class="mafw-bg-detail">
                    <pre class="mafw-bg-output">{taskOutputs()[t.id] ?? "加载中…"}</pre>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={rows().length > 0} fallback={
        <Show when={tasks().length === 0}>
        <div class="mafw-bg-dock-empty">
          <div class="mafw-bg-dock-empty-icon">⚡</div>
          <div class="mafw-bg-dock-empty-text">本会话暂无后台任务</div>
          <div class="mafw-bg-dock-empty-hint">shell 工具加 background 参数，或点 composer 上方「全部转后台」</div>
        </div>
        </Show>
      }>
        <For each={rows()}>
          {(r) => (
            <div class="mafw-bg-row-wrap">
              <div
                class={`mafw-bg-row mafw-bg-${r.status}`}
                role="button"
                tabIndex={0}
                title={r.label}
                onClick={() => toggle(r)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(r) }
                }}
              >
                <span class="mafw-bg-kind">{r.type === "shell" ? "🐚" : "🤖"}</span>
                <div class="mafw-bg-main">
                  <div class="mafw-bg-title">{r.label || r.id}</div>
                  <div class="mafw-bg-meta">
                    <span class={`mafw-bg-status mafw-bg-status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    <span>{elapsed(r)}</span>
                  </div>
                </div>
                <Show when={r.status === "running"}><span class="mafw-bg-spinner" /></Show>
              </div>
              <Show when={r.type === "shell" && expanded() === r.id}>
                <div class="mafw-bg-detail">
                  <pre class="mafw-bg-output">{outputs()[r.id] ?? outputPlaceholder(restState())}</pre>
                  <div class="mafw-bg-actions">
                    <Show when={restState() === "available"}>
                      <ButtonV2 variant="ghost" size="small" onClick={() => void refreshOutput(r)}>刷新</ButtonV2>
                    </Show>
                    <Show when={restState() === "available" && r.status === "running"}>
                      <ButtonV2 variant="outline" size="small" onClick={() => void terminate(r)}>
                        {confirming() === r.id ? "确认终止" : "终止"}
                      </ButtonV2>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  )
}
