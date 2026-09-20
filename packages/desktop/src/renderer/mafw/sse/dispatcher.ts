// SSE dispatcher：gateway /api/events 帧 → 类型化 handler 组。
// 纯路由；一切副作用经注入 deps，逐分支可单测（无 Solid / 无 DOM）。
// 分支语义逐字迁移自 MafwShell.tsx onmessage（commit 13ad8348，行 1297-1353、1361-1368）。
import { planSessionEvent, isTailAccountedAtShell, type RawSessionEvent } from "../session-events"
import { handleFlowCardEvent, type FlowCardDeps } from "./handlers/flow-cards"
import { handleDockEvent, type DockDeps } from "./handlers/dock"

export interface CoreDeps {
  trace(event: { type?: string }, channel: string): void
  notify(title: string, body: string): void
  warn(message: string): void
  setActiveQuestion(q: unknown): void
  bumpProjectsRev(): void
  onRuntimeSwitched(): void
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

export interface ShellEventDeps {
  core: CoreDeps
  lifecycle: LifecycleDeps
  flowCards: FlowCardDeps
  dock: DockDeps
}

/** sid 级处理器挂这里；返回 true = 已消费。 */
export type SidHandler = (event: any, sid: string, deps: ShellEventDeps) => boolean
export const EXTRA_HANDLERS: SidHandler[] = []
EXTRA_HANDLERS.push(handleFlowCardEvent)
EXTRA_HANDLERS.push(handleDockEvent)

/** 语义与 MafwShell.tsx:1356-1360 一致：sid 可多形态承载。 */
export function sessionIdOf(event: any): string {
  return event?.sessionID
    || event?.properties?.sessionID
    || event?.properties?.part?.sessionID
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

  if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
    deps.core.trace(event, "rail:planner")
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
