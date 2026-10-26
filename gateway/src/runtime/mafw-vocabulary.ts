/**
 * MAFW 事件词汇 v2 —— gateway 侧单一事实源。
 *
 * 客户端契约单源在 packages/gateway-sdk/src/events.ts（零 import 约定），
 * 本模块与它经 vocabulary-sync.test.ts 双向交叉钉扎一致；gateway 内部
 * （facet 规则表 / field-contract / assembler / index 分支 / 映射表）
 * 引用本常量而非字符串字面量——词汇再演进时改这里 + SDK 两处，守卫链指路。
 *
 * 设计：docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md
 */

export const MAFW = {
  // 会话生命周期
  sessionCreated: 'session.created',
  sessionUpdated: 'session.updated',
  sessionDeleted: 'session.deleted',
  // 回合生命周期（v3 增 turn.started；终态三元组 v2 起为一等公民，原双轨合并）
  turnStarted: 'turn.started',
  turnCompleted: 'turn.completed',
  turnFailed: 'turn.failed',
  turnAborted: 'turn.aborted',
  // 压缩
  sessionCompacting: 'session.compacting',
  sessionCompacted: 'session.compacted',
  // 消息与 part 流（原 message.part.* 去冗余前缀）
  messageUpdated: 'message.updated',
  partUpdated: 'part.updated',
  partDelta: 'part.delta',
  partComplete: 'part.complete',
  // 问答 / 审批
  questionAsked: 'question.asked',
  questionReplied: 'question.replied',
  questionRejected: 'question.rejected',
  permissionAsked: 'permission.asked',
  permissionReplied: 'permission.replied',
  // 数据面（plan.updated 原 todo.updated；usage.updated v2 新增）
  planUpdated: 'plan.updated',
  usageUpdated: 'usage.updated',
  queueUpdated: 'queue.updated',
  taskUpdated: 'task.updated',
  trajectoryEvent: 'trajectory.event',
  trajectoryTurn: 'trajectory.turn',
  // 能力面
  permissionMode: 'permission_mode',
  sessionDiff: 'session.diff',
  // wire 信封类型
  envelope: 'mafw_event',
} as const;

/** gateway 侧 runtime 事件名全集（= SDK RUNTIME_EVENT_TYPES；交叉测试钉扎）。 */
export const MAFW_RUNTIME_EVENT_NAMES: readonly string[] = Object.values(MAFW).filter(
  (v) => v !== MAFW.envelope,
);

/** gateway 侧扁平广播名全集（= SDK FLAT_EVENT_TYPES；交叉测试钉扎）。 */
export const MAFW_FLAT_EVENT_NAMES: readonly string[] = [
  'user_question', 'user_feedback', 'goal_created', 'state_change', 'phase_transition',
  'memory_written', 'memory_energy_changed', 'memory_distillation_complete',
  'automation_triggered', 'automation_completed', 'project_registered',
  'runtime_switched', 'mafw_commands_changed', 'goal_node', 'connected',
];
