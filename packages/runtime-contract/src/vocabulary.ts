/**
 * MAFW canonical event vocabulary v2 — the single source of truth.
 *
 * Moved verbatim from `gateway/src/runtime/mafw-vocabulary.ts` (Plan 6 Task 3)
 * so runtime drivers can declare canonical identity rows without importing the
 * gateway. The gateway module stays as a re-export shim; the client contract
 * mirror in `packages/gateway-sdk/src/events.ts` is still cross-pinned by
 * `gateway/tests/unit/runtime/vocabulary-sync.test.ts`.
 *
 * Design: docs/superpowers/specs/2026-10-12-native-event-vocabulary-design.md
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
  /** 三源统一的后台作业状态（替换 synthetic chat-message 伪装）。 */
  backgroundJobUpdated: 'background.job.updated',
  podUpdated: 'pod.updated',
  podEvent: 'pod.event',
  sessionConfig: 'session.config',
  sessionCheckpoint: 'session.checkpoint',
  runUpdated: 'run.updated',
  trajectoryEvent: 'trajectory.event',
  trajectoryTurn: 'trajectory.turn',
  // 能力面
  permissionMode: 'permission_mode',
  sessionDiff: 'session.diff',
  sessionCommands: 'session.commands',
  // wire 信封类型
  envelope: 'mafw_event',
} as const;

/** Runtime 事件名全集（= gateway SDK RUNTIME_EVENT_TYPES；交叉测试钉扎）。 */
export const MAFW_RUNTIME_EVENT_NAMES: readonly string[] = Object.values(MAFW).filter(
  (v) => v !== MAFW.envelope,
);

/** 工具三原语（canonical 直发词汇；tool part 流的一等类型）。 */
export const TOOL_PRIMITIVE_TYPES: ReadonlySet<string> = new Set([
  'tool.call',
  'tool.delta',
  'tool.result',
]);

/**
 * canonical 恒等翻译词汇：MAFW 事件面 ∪ 工具三原语。
 *
 * `event-mapping` 的 `canonicalIdentity()` / `canonicalTypeSet()` 要求调用方
 * 显式给出词汇；驱动方用这份全集声明「原生同名事件直接放行」。
 */
export const RUNTIME_IDENTITY_TYPES: readonly string[] = [
  ...MAFW_RUNTIME_EVENT_NAMES,
  ...TOOL_PRIMITIVE_TYPES,
];
