/**
 * Canonical SSE 事件契约 —— gateway 与全部客户端（desktop/TUI）的单一事实源。
 *
 * 本文件必须保持零 import：gateway jest 经相对路径直接 import，
 * desktop/TUI 经 @mafw/sdk import。新增事件类型 = 在这里加一行，
 * desktop/TUI 的穷尽检查随即编译报错，指向需要接线的位置。
 *
 * v2（2026-10-12）：词汇所有权归 MAFW（spec 2026-10-12-native-event-vocabulary-design.md）。
 * turn 三元组取代 session.idle/message.complete/message.error/message.aborted 双轨；
 * part.* 去冗余前缀；信封 mafw_event；gateway 侧常量镜像在
 * gateway/src/runtime/mafw-vocabulary.ts（双向交叉测试钉扎一致）。
 */

/** mafw_event 信封内层 data.type 全集（runtime 原生事件经翻译层后的 canonical 名） */
export const RUNTIME_EVENT_TYPES = [
  "session.created", "session.updated", "session.deleted",
  "turn.started", "turn.completed", "turn.failed", "turn.aborted",
  "session.compacting", "session.compacted",
  "message.updated", "part.updated", "part.delta", "part.complete",
  "question.asked", "question.replied", "question.rejected",
  "permission.asked", "permission.replied",
  "plan.updated", "usage.updated", "queue.updated", "task.updated", "session.config",
  "trajectory.event", "trajectory.turn",
  "permission_mode", "session.diff",
] as const

export type RuntimeEventType = typeof RUNTIME_EVENT_TYPES[number]

/** 顶层扁平广播 type 全集（无 data 信封；见 gateway event-broadcast.ts 的扁平约定） */
export const FLAT_EVENT_TYPES = [
  "user_question", "user_feedback", "goal_created", "state_change",
  "phase_transition", "memory_written", "memory_energy_changed",
  "memory_distillation_complete", "automation_triggered", "automation_completed",
  "project_registered", "runtime_switched", "mafw_commands_changed", "goal_node",
  "connected",
] as const

export type FlatEventType = typeof FLAT_EVENT_TYPES[number]

/** mafw_event 信封内层载荷（wire 契约见 gateway event-broadcast.ts） */
export interface MafwEventData {
  type: RuntimeEventType | `plugin:${string}`
  properties?: any
  sessionID?: string
  directory?: string
  error?: string
  internal?: boolean
}

export interface MafwEventEnvelope {
  type: "mafw_event"
  data: MafwEventData
}

/** 顶层扁平广播：判别 union，载荷宽松（各消费方自行窄化） */
export type FlatGatewayEvent =
  | { type: "user_question"; goalId?: string; questionId?: string; question?: string }
  | { type: "user_feedback"; goalId?: string; targetId?: string }
  | { type: "goal_created"; goalId?: string; projectDir?: string }
  | { type: "state_change"; goalId?: string; patch?: any; projectDir?: string }
  | { type: "phase_transition"; goalId?: string; phase?: string }
  | { type: "memory_written"; id?: string }
  | { type: "memory_energy_changed" }
  | { type: "memory_distillation_complete" }
  | { type: "automation_triggered"; ruleId?: string }
  | { type: "automation_completed"; ruleId?: string }
  | { type: "project_registered"; projectDir: string }
  | { type: "runtime_switched"; runtime: string; previous: string | null }
  | { type: "mafw_commands_changed" }
  | { type: "goal_node"; goalId?: string; projectDir?: string; loop?: number; node?: string; [key: string]: any }
  | { type: "connected"; timestamp?: string; vocab?: string }
  | { type: `plugin:${string}`; [key: string]: any }

/** /api/events 上一帧的完整 union（剥壳前） */
export type GatewayEvent = MafwEventEnvelope | FlatGatewayEvent

/** 剥壳后的统一视图（desktop `raw?.data || raw` 的产物） */
export type UnwrappedEvent = MafwEventData | FlatGatewayEvent

/**
 * 穷尽性守卫：switch/if-chain 末端调用。所有 union 成员都被分支消费后
 * 残余类型为 never 才编译通过；新增事件类型时，调用点编译报错，
 * 精确指向需要接线的位置。
 */
export function assertNever(x: never, context?: string): never {
  throw new Error(
    `Unhandled event${context ? ` at ${context}`: ""}: ${JSON.stringify(x)}`
  )
}
