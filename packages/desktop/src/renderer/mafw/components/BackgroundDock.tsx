// RightDock「后台」面板（Task 11）：只消费中性 `MafwBackgroundJob`。
//
// - 三源统一（runtime shell / gateway 持久任务 / 子代理）由 gateway jobs façade
//   合并，桌面不再分两段渲染，也不再直连运行时原生 shell 命令；
// - shell 行：点击展开输出（`background.jobs.output`，按需拉取）；
// - 子代理行：点击进入子会话；
// - 运行中行可终止（`background.jobs.cancel`，内联二次确认）；
// - 数据：canonical `background.job.updated` 实时推送 + `background.jobs.list` 快照。
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import type { MafwBackgroundJob } from "@mafw/sdk"
import { ConfirmOverlay } from "./ConfirmOverlay"
import { menuController } from "../context-menu/controller"
import { buildExecutionRowMenu } from "../context-menu/builders/panel"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import { openMenuOnKey } from "../context-menu/menu-key"
import { backgroundJobs, ingestBackgroundJob, ingestBackgroundJobs } from "../background-store"
import { isActiveJobStatus, jobLabel, jobsForSession, type BackgroundJob } from "../background-jobs"
import { reconcileBackgroundOnce } from "../background-reconcile"
import { formatDuration } from "../goal-timeline"
import {
  backgroundApiState,
  probeBackgroundApi,
  outputPlaceholder,
  shouldShowBackgroundUnavailableHint,
  type BackgroundApiState,
} from "../background-capability"

const STATUS_LABEL: Record<string, string> = {
  running: "运行中",
  input_required: "等待输入",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
}

const SOURCE_LABEL: Record<string, string> = {
  "runtime-shell": "运行时 shell",
  "mafw-task": "网关任务",
  subagent: "子代理",
}

function startedAt(job: BackgroundJob): number {
  return job.time?.created ?? job.time?.updated ?? Date.now()
}

function endedAt(job: BackgroundJob): number {
  return job.time?.completed ?? job.time?.updated ?? startedAt(job)
}

export function BackgroundDock(props: {
  activeSessionId: string | null
  onOpenSession: (id: string) => void
}) {
  const [now, setNow] = createSignal(Date.now())
  const [expanded, setExpanded] = createSignal<string | null>(null)
  const [outputs, setOutputs] = createSignal<Record<string, string>>({})
  const [apiState, setApiState] = createSignal<BackgroundApiState>(backgroundApiState())
  const [confirming, setConfirming] = createSignal<string | null>(null)
  const [cancelTarget, setCancelTarget] = createSignal<string | null>(null)

  const jobs = () => jobsForSession(backgroundJobs(), props.activeSessionId ?? "")
  const sid = () => props.activeSessionId ?? ""

  createEffect(() => { void probeBackgroundApi().then(setApiState) })
  createEffect(() => {
    if (!jobs().some((j) => j.kind === "shell")) return
    const t = setInterval(() => { void probeBackgroundApi().then(setApiState) }, 60_000)
    onCleanup(() => clearInterval(t))
  })
  createEffect(() => {
    if (!jobs().some((j) => isActiveJobStatus(j.status))) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(t))
  })
  // 面板打开/会话切换：拉一次权威快照（静默合并；fail-open）。
  createEffect(() => {
    const sessionID = props.activeSessionId
    if (!sessionID) return
    void reconcileBackgroundOnce({
      sessionID,
      fetchers: { listJobs: (id) => window.api.mafw.background.jobs.list(id) },
      ingest: (list) => ingestBackgroundJobs(list),
    })
  })

  const elapsed = (job: BackgroundJob) =>
    formatDuration((isActiveJobStatus(job.status) ? now() : endedAt(job)) - startedAt(job))

  const toggle = (job: BackgroundJob) => {
    if (job.kind === "subagent") {
      props.onOpenSession(job.childSessionID || job.id)
      return
    }
    setConfirming(null)
    setExpanded(expanded() === job.id ? null : job.id)
  }

  const refreshOutput = async (job: BackgroundJob) => {
    try {
      const out = await window.api.mafw.background.jobs.output(sid(), job.id)
      setOutputs((prev) => ({ ...prev, [job.id]: out.data || "(无输出)" }))
    } catch (e: any) {
      showToastV2({ description: `读取输出失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  const terminate = async (jobId: string) => {
    try {
      const updated = await window.api.mafw.background.jobs.cancel(sid(), jobId)
      ingestBackgroundJob(updated as MafwBackgroundJob)
      showToastV2({ description: "已终止后台任务", duration: 2000 } as any)
    } catch (e: any) {
      showToastV2({ description: `终止失败：${String(e?.message ?? e).slice(0, 60)}`, variant: "error", duration: 3000 } as any)
    }
  }

  const requestMenu = (job: BackgroundJob, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    menuController.request(
      buildExecutionRowMenu,
      {
        ...(job.childSessionID ? { sessionID: job.childSessionID } : {}),
        taskID: job.id,
        kind: job.kind === "shell" ? "background" : "subagent",
        canCancel: isActiveJobStatus(job.status),
      },
      (id) => {
        if (id === "panel.openSession" && job.childSessionID) props.onOpenSession(job.childSessionID)
        else if (id === "panel.copyId") void navigator.clipboard.writeText(job.id)
        else if (id === "panel.cancel") setCancelTarget(job.id)
      },
      { point: { x: event.clientX, y: event.clientY }, returnFocus: event.currentTarget as HTMLElement },
    )
  }

  const confirmCancel = () => {
    const id = cancelTarget()
    setCancelTarget(null)
    if (id) void terminate(id)
  }

  return (
    <div class="mafw-bg-dock">
      <div class="mafw-bg-dock-hint">本会话后台任务（shell 可看输出/终止，子代理点击进入子会话）</div>
      <Show when={shouldShowBackgroundUnavailableHint(apiState(), jobs().length > 0)}>
        <div class="mafw-bg-dock-rest-hint">当前 gateway/runtime 未提供后台作业接口：输出/终止暂不可用</div>
      </Show>
      <Show when={jobs().length > 0} fallback={
        <div class="mafw-bg-dock-empty">
          <div class="mafw-bg-dock-empty-icon">⏳</div>
          <div class="mafw-bg-dock-empty-text">本会话暂无后台任务</div>
          <div class="mafw-bg-dock-empty-hint">shell 工具加 background 参数，或在 composer 上方「全部转后台」</div>
        </div>
      }>
        <For each={jobs()}>
          {(job) => (
            <div class="mafw-bg-row-wrap">
              <div
                class={`mafw-bg-row mafw-bg-${job.status === "input_required" ? "running" : job.status}`}
                role="button"
                tabIndex={0}
                title={jobLabel(job)}
                onClick={() => toggle(job)}
                onContextMenu={(event) => requestMenu(job, event)}
                onKeyDown={(e: KeyboardEvent) => {
                  openMenuOnKey(e)
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(job) }
                }}
              >
                <span class="mafw-bg-kind">{job.kind === "shell" ? "🐚" : "🤖"}</span>
                <div class="mafw-bg-main">
                  <div class="mafw-bg-title">{jobLabel(job)}</div>
                  <div class="mafw-bg-meta">
                    <span class={`mafw-bg-status mafw-bg-status-${job.status === "input_required" ? "running" : job.status}`}>
                      {STATUS_LABEL[job.status] ?? job.status}
                    </span>
                    <span class="mafw-bg-source">{SOURCE_LABEL[job.source] ?? job.source}</span>
                    <span>{elapsed(job)}</span>
                  </div>
                </div>
                <Show when={isActiveJobStatus(job.status)}><span class="mafw-bg-spinner" /></Show>
              </div>
              <Show when={job.kind === "shell" && expanded() === job.id}>
                <div class="mafw-bg-detail">
                  <pre class="mafw-bg-output">{outputs()[job.id] ?? outputPlaceholder(apiState())}</pre>
                  <div class="mafw-bg-actions">
                    <Show when={apiState() === "available"}>
                      <ButtonV2 variant="ghost" size="small" onClick={() => void refreshOutput(job)}>刷新</ButtonV2>
                    </Show>
                    <Show when={apiState() === "available" && isActiveJobStatus(job.status)}>
                      <ButtonV2
                        variant="outline"
                        size="small"
                        onClick={() => {
                          if (confirming() === job.id) {
                            setConfirming(null)
                            void terminate(job.id)
                          } else {
                            setConfirming(job.id)
                          }
                        }}
                      >
                        {confirming() === job.id ? "确认终止" : "终止"}
                      </ButtonV2>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </For>
      </Show>
      <ConfirmOverlay
        open={cancelTarget() !== null}
        title="终止后台任务"
        message="任务会被立即取消；已产生的输出仍保留在任务记录里。"
        confirmLabel="终止"
        danger
        onConfirm={confirmCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
