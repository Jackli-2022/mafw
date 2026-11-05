// SSE dispatcher：gateway /api/events 帧 → 类型化 handler 组。
// 纯路由；一切副作用经注入 deps，逐分支可单测（无 Solid / 无 DOM）。
// 分支语义逐字迁移自 MafwShell.tsx onmessage（commit 13ad8348，行 1297-1353、1361-1368）。
import { planSessionEvent, isTailAccountedAtShell, type RawSessionEvent } from "../session-events"
import { handleFlowCardEvent, type FlowCardDeps } from "./handlers/flow-cards"
import { handleDockEvent, type DockDeps } from "./handlers/dock"
import { handleChatStreamEvent, handleMediaSpeakEvent, type ChatDeps } from "./handlers/chat-stream"
import { handleDiffEvent, type DiffDeps } from "./handlers/diff"
import { handleQueueEvent } from "./handlers/queue"
import { handleSubagentEvent, mapSessionLifecycleEvent } from "./handlers/subagents"
import { handleBackgroundEvent } from "./handlers/background"
import { handlePluginSseEvent } from "./handlers/plugins"
import type { TrackerEvent } from "../subagent-tracker"
import type { BackgroundJob } from "../background-jobs"

export interface CoreDeps {
  trace(event: { type?: string }, channel: string): void
  notify(title: string, body: string): void
  warn(message: string): void
  setActiveQuestion(q: unknown): void
  bumpProjectsRev(): void
  onRuntimeSwitched(): void
  onGoalEvent(event: unknown): void
  /** W0-1：session.checkpoint → bump checkpointRev（overlay 打开时重拉）。 */
  onCheckpointEvent(): void
}

export interface LifecycleDeps {
  invalidate(): void
  patch(id: string, patch: { title?: string; time?: { updated?: number }; directory?: string; projectID?: string }): void
  /** 打开中的 tab 与 ChatPane 各持一份 title 副本，patch 带 title 时双写。 */
  retitleOpenTab(id: string, title: string): void
  remove(id: string): void
  /** 外部删除已打开的 tab 时关闭（active 回退、分屏摘叶由实现方负责）。 */
  closeIfOpen(id: string): void
}

/** 子代理 tracker 旁路（spec §4.3）：消费既有事件，零词汇改动。 */
export interface SubagentDeps {
  onEvent(ev: TrackerEvent): void
}

/** 后台作业（Task 3 三源统一）：canonical `background.job.updated` 旁路入 store。 */
export interface BackgroundDeps {
  onEvent(job: BackgroundJob): void
}

/** Durable task 事件（Batch 4）：task.updated 顶层广播。 */
export interface TaskDeps {
  onEvent(task: unknown): void
}

/** Gateway 服务端队列快照（Batch 5）：queue.updated。 */
export interface QueueDeps {
  onEvent(sid: string, event: unknown): void
}

/** T2-2：回合软暂停状态（run.updated）。 */
export interface RunDeps {
  onEvent(run: unknown): void
}

export interface PodDeps {
  /** `pod.updated`：Pod 详情变了（Goal/任务/消息）→ 刷新 detail。 */
  onEvent(event: unknown): void
  /** `pod.event`：事件层写入后的通知（inbox/角标），与 detail 刷新分开。 */
  onPodEvent(event: unknown): void
}

/** Task 7: unified plugin package revision + registered package events. */
export interface PluginDeps {
  /** `plugins.changed` → refresh the committed client snapshot once. */
  onChanged(event: unknown): void
  /** `plugin:<package>:<event>` → registered event hub. */
  onEvent(event: unknown): void
}

export interface ShellEventDeps {
  core: CoreDeps
  lifecycle: LifecycleDeps
  flowCards: FlowCardDeps
  dock: DockDeps
  chat: ChatDeps
  diff: DiffDeps
  subagents: SubagentDeps
  background: BackgroundDeps
  tasks: TaskDeps
  queue: QueueDeps
  run: RunDeps
  pod: PodDeps
  plugins: PluginDeps
}

/** sid 级处理器挂这里；返回 true = 已消费。 */
export type SidHandler = (event: any, sid: string, deps: ShellEventDeps) => boolean
export const EXTRA_HANDLERS: SidHandler[] = []
EXTRA_HANDLERS.push(handleFlowCardEvent)
EXTRA_HANDLERS.push(handleDockEvent)
EXTRA_HANDLERS.push(handleBackgroundEvent)
EXTRA_HANDLERS.push(handleSubagentEvent) // 必须在 chat-stream 之前：part.updated 会被 chat-stream 消费；本 handler 恒 return false
EXTRA_HANDLERS.push(handleChatStreamEvent)
EXTRA_HANDLERS.push(handleMediaSpeakEvent)
EXTRA_HANDLERS.push(handleDiffEvent)
EXTRA_HANDLERS.push(handleQueueEvent)

/** 语义与 MafwShell.tsx:1356-1360 一致：sid 可多形态承载。 */
export function sessionIdOf(event: any): string {
  return event?.sessionID
    || event?.properties?.sessionID
    || event?.properties?.part?.sessionID
    || event?.properties?.message?.sessionID
    || event?.properties?.info?.sessionID
    || ""
}

function missTrace(event: any, deps: ShellEventDeps): void {
  if (!isTailAccountedAtShell(event.type)) {
    deps.core.warn(`[mafw] unhandled SSE event at shell: ${event.type}`)
    deps.core.trace(event, "miss")
  }
}

export function dispatchShellEvent(event: any, deps: ShellEventDeps): void {
  if (!event) return

  // opencode v2 sync 信封（{syncEvent:{type:'*.1',...}}，与 legacy 事件双发）：
  // gateway 边界已丢弃（RUNTIME_NATIVE_DROPPED）；此处兜底消费，防 gateway
  // 版本偏差泄漏时刷屏（语义重复，三端只消费 legacy 事件）。
  if (event.type === "sync") {
    deps.core.trace(event, "sync-envelope")
    return
  }

  // SSE 问候帧（建连/重连首帧，gateway /api/events 直发）：静默消费防 miss
  // 告警刷屏；连接状态机由 EventSource onopen 驱动，此帧仅作到达确认。
  if (event.type === "connected") {
    deps.core.trace(event, "conn:greeting")
    return
  }

  // Task 7：统一插件修订 + 包事件（全局帧，常无 sessionID）。必须在 sid
  // 分发前消费，否则全局 plugin 事件会落到尾部 missTrace、plugins.changed
  // 会按类静默忽略。
  if (handlePluginSseEvent(event, deps)) return

  if (event.type === "user_question") {
    deps.core.trace(event, "notify:question")
    deps.core.setActiveQuestion(event)
    deps.core.notify("MAFW：Agent 需要你的回答", String(event.question || "").slice(0, 80))
    return
  }

  if (event.type === "project_registered") {
    deps.core.trace(event, "rail:projects")
    deps.core.bumpProjectsRev()
    return
  }

  if (event.type === "runtime_switched") {
    deps.core.trace(event, "rail:runtime")
    deps.core.onRuntimeSwitched()
    return
  }

  if (event.type === "pod.updated") {
    deps.core.trace(event, "pod:updated")
    deps.pod.onEvent(event)
    return
  }

  // 事件层（Task 9）：`pod.event` 只进 inbox store（角标/未查看标记），
  // 不触发 Pod 详情刷新——详情已由同一写点的 `pod.updated` 负责。
  if (event.type === "pod.event") {
    deps.core.trace(event, "pod:event")
    deps.pod.onPodEvent(event)
    return
  }

  // Goal 编排事件（spec P2 §7）：goal_node 无 sessionID，必须在 sid 分发前消费。
  if (event.type === "goal_node" || event.type === "goal_created" || event.type === "phase_transition") {
    deps.core.trace(event, "goals:rev")
    deps.core.onGoalEvent(event)
    return
  }

  // W0-1：服务端检查点事件 → bump checkpointRev，打开中的 CheckpointOverlay 重拉。
  if (event.type === "session.checkpoint") {
    deps.core.trace(event, "checkpoint:rev")
    deps.core.onCheckpointEvent()
    return
  }

  if (event.type === "form.created" || event.type === "form.updated" || event.type === "form.replied" || event.type === "form.cancelled") {
    deps.core.trace(event, "card:form-refresh")
    deps.flowCards.scheduleReconcile(50)
    return
  }

  if (event.type === "task.updated") {
    deps.core.trace(event, "task:updated")
    const task = event.properties?.task ?? event.task
    if (task) deps.tasks.onEvent(task)
    return
  }

  if (event.type === "run.updated") {
    deps.core.trace(event, "run:updated")
    const run = event.properties?.run ?? event.run
    if (run) deps.run.onEvent(run)
    return
  }

  if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
    deps.core.trace(event, "rail:planner")
    // 子代理 tracker 旁路（既有行为不变，只加转发）：child 事件在这里被
    // lifecycle 分支消化前先喂给 subagents 组（session.created 的 child 会被
    // planner 判 none，不产生 Rail 变化；subagents 组负责行跟踪）。
    const subEv = mapSessionLifecycleEvent(event)
    if (subEv) deps.subagents.onEvent(subEv)
    const action = planSessionEvent(event as RawSessionEvent)
    if (action.kind === "invalidate") {
      deps.lifecycle.invalidate()
    } else if (action.kind === "patch") {
      deps.lifecycle.patch(action.id, action.patch)
      if (typeof action.patch.title === "string") deps.lifecycle.retitleOpenTab(action.id, action.patch.title)
    } else if (action.kind === "remove") {
      deps.lifecycle.remove(action.id)
      deps.lifecycle.closeIfOpen(action.id)
    }
    return
  }

  const sid = sessionIdOf(event)
  if (!sid) { missTrace(event, deps); return }

  for (const handler of EXTRA_HANDLERS) {
    if (handler(event, sid, deps)) return
  }

  missTrace(event, deps)
}
