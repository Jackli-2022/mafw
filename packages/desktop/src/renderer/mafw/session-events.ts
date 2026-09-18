// Plans sessionStore actions from raw /api/events SSE lifecycle events.
// The gateway broadcasts opencode runtime events passthrough as
// { type, properties, sessionID?, internal? }; this module is the single
// place deciding what a lifecycle event means for the desktop caches.
//
// Hidden-session parity with gateway listSessions (gateway/src/index.ts
// isHiddenSession): subagent children (parentID) and legacy worker title
// prefixes never reach the desktop list, so their events must not create
// churn either. Gateway drops memory-worker lifecycle noise itself; the
// internal flag covers anything that slips through.
//
// Overwrite guard: SSE `info` lacks the local `metadata.mafw.role` that
// listSessions enriches in, so patches carry a strict field whitelist —
// never a spread of info.

export type SessionEventPatch = {
  title?: string
  time?: { updated?: number }
  directory?: string
  projectID?: string
}

export type SessionEventAction =
  | { kind: "patch"; id: string; patch: SessionEventPatch }
  | { kind: "remove"; id: string }
  | { kind: "invalidate"; directory?: string }
  | { kind: "none" }

export type RawSessionEvent = {
  type?: string
  properties?: {
    sessionID?: string
    info?: {
      id?: string
      title?: string
      directory?: string
      projectID?: string
      parentID?: string
      time?: { updated?: number }
    }
  }
  sessionID?: string
  internal?: boolean
}

const LEGACY_WORKER_TITLE_PREFIXES = ["# Memory Index", "{", "```", "标题："]

const isHiddenSessionInfo = (info: NonNullable<NonNullable<RawSessionEvent["properties"]>["info"]>): boolean => {
  if (info.parentID) return true
  const title = info.title || ""
  return LEGACY_WORKER_TITLE_PREFIXES.some(prefix => title.startsWith(prefix))
}

const sessionIdOf = (evt: RawSessionEvent): string | undefined =>
  evt.sessionID || evt.properties?.sessionID || evt.properties?.info?.id

export function planSessionEvent(evt: RawSessionEvent): SessionEventAction {
  const type = evt.type
  const info = evt.properties?.info
  if (evt.internal) return { kind: "none" }

  if (type === "session.created") {
    if (!info || isHiddenSessionInfo(info)) return { kind: "none" }
    // Broadcast carries no project mapping, so the consumer refetches cached
    // buckets; directory (from info) is passed for targeted consumers.
    return { kind: "invalidate", directory: info.directory }
  }

  if (type === "session.updated") {
    if (!info || isHiddenSessionInfo(info)) return { kind: "none" }
    const id = sessionIdOf(evt)
    if (!id) return { kind: "none" }
    const patch: SessionEventPatch = {}
    if (typeof info.title === "string") patch.title = info.title
    if (typeof info.time?.updated === "number") patch.time = { updated: info.time.updated }
    if (typeof info.directory === "string") patch.directory = info.directory
    if (typeof info.projectID === "string") patch.projectID = info.projectID
    return { kind: "patch", id, patch }
  }

  if (type === "session.deleted") {
    const id = sessionIdOf(evt)
    if (!id) return { kind: "none" }
    return { kind: "remove", id }
  }

  return { kind: "none" }
}

// ---------------------------------------------------------------------------
// Shell 事件覆盖守卫 —— 防止 gateway 新增事件类型时 desktop 静默漏接。
//
// 编译期强制：assertShellEventCoverage 用 switch 残余窄化把
// @mafw/sdk 的 canonical union 分为「MafwShell 有分支」/「显式忽略」/
// 「plugin:* 模板」三类；SDK union 扩展而本文件未归类时，tsgo typecheck
// 直接报错指向这里（gateway 矩阵测试同时红，两处指路）。
//
// 运行期兜底：isTailAccountedAtShell 在 MafwShell onmessage 尾部判定
// "到这里还没被任何分支消费"的事件是否属于尾部合法放行（else-if 链 /
// 前缀类）；不属于 = 未知类型 = 漏接线，warn 留痕。
// ---------------------------------------------------------------------------

import type { UnwrappedEvent } from "@mafw/sdk"

/** MafwShell onmessage 显式不消费的事件（有意 ignore，非遗漏）。 */
export const IGNORED_AT_SHELL = [
  "user_feedback", "goal_created", "state_change", "phase_transition",
  "memory_written", "memory_energy_changed", "memory_distillation_complete",
  "automation_triggered", "automation_completed",
  "mafw_commands_changed", "session.compacting",
  "session.next.step.ended", "session.next.reasoning.ended", "session.next.tool.failed",
] as const

/** onmessage 尾部合法放行：else-if 链处理（分支不 return 落到尾部）的类型。 */
const TAIL_ACCOUNTED_TYPES = new Set<string>([
  "message.part.updated", "message.complete", "message.part.complete",
  "session.idle", "session.error", "message.error", "message.aborted",
])

/** onmessage 尾部合法放行的前缀类（plugin 自定义 / legacy tool 事件族）。 */
const TAIL_ACCOUNTED_PREFIXES = ["plugin:", "session.next.tool."]

/** 尾部未见过的类型 = 漏接线（返回 false）。显式忽略清单并入合法放行。 */
export function isTailAccountedAtShell(type: string | undefined): boolean {
  if (!type) return true
  if ((IGNORED_AT_SHELL as readonly string[]).includes(type)) return true
  if (TAIL_ACCOUNTED_TYPES.has(type)) return true
  return TAIL_ACCOUNTED_PREFIXES.some((p) => type.startsWith(p))
}

/** MafwShell 有分支消费的事件（与 onmessage 分支一一对应，改分支必须同步）。 */
type ShellHandledType =
  | "user_question" | "project_registered" | "runtime_switched"
  | "session.created" | "session.updated" | "session.deleted"
  | "question.asked" | "question.replied" | "question.rejected"
  | "permission.asked" | "permission.replied" | "session.compacted"
  | "trajectory.event" | "trajectory.turn" | "todo.updated"
  | "message.updated" | "message.part.delta" | "message.part.updated"
  | "message.complete" | "message.part.complete"
  | "session.idle" | "session.error" | "message.error" | "message.aborted"

/**
 * 类型级穷尽检查（永不抛错，编译失败即守卫生效）：
 * canonical union 中每个成员必须落入 ShellHandledType / IGNORED_AT_SHELL /
 * plugin:* 之一；SDK 新增类型未归类时，default 分支的赋值编译报错。
 */
export function assertShellEventCoverage(e: UnwrappedEvent): void {
  switch (e.type) {
    case "user_question":
    case "project_registered":
    case "runtime_switched":
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
    case "permission.asked":
    case "permission.replied":
    case "session.compacted":
    case "trajectory.event":
    case "trajectory.turn":
    case "todo.updated":
    case "message.updated":
    case "message.part.delta":
    case "message.part.updated":
    case "message.complete":
    case "message.part.complete":
    case "session.idle":
    case "session.error":
    case "message.error":
    case "message.aborted":
    case "user_feedback":
    case "goal_created":
    case "state_change":
    case "phase_transition":
    case "memory_written":
    case "memory_energy_changed":
    case "memory_distillation_complete":
    case "automation_triggered":
    case "automation_completed":
    case "mafw_commands_changed":
    case "session.compacting":
    case "session.next.step.ended":
    case "session.next.reasoning.ended":
    case "session.next.tool.failed":
      return
    default: {
      // 残余必须恰好是 plugin:* 模板；出现任何其他字面量 = 有事件未归类。
      const residual: `plugin:${string}` = e.type
      void residual
    }
  }
}
