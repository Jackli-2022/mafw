/**
 * 事件链路矩阵 —— 每个 canonical 事件在每一跳的消费处置，显式声明。
 *
 * 列：
 *   normalizeFacet — gateway normalize.ts 抽出的切面（step/chatSignal/broadcast/compaction/toolCommand），空数组 = 仅透传
 *   modeA          — Mode A 全局广播处置：passthrough 原样 / rewrite 改写（如 session.idle→message.complete）/ drop 不广播
 *   desktop / tui  — 客户端消费：handled = 有分支；ignore = 显式不消费（有意）
 *
 * 新增事件类型时必须在此加行（SDK union 扩展 → 遍历测试变红指向本文件），
 * 填每一格时即完成"这个事件每一跳怎么办"的通盘思考。
 * 事件清单的单一事实源在 packages/gateway-sdk/src/events.ts（本文件经测试
 * 与其交叉校验，不直接 import 以免 gateway 依赖 SDK 源码）。
 */

export interface EventFlowRow {
  normalizeFacet: string[];
  modeA: 'passthrough' | 'rewrite' | 'drop';
  desktop: 'handled' | 'ignore';
  tui: 'handled' | 'ignore';
  note?: string;
}

const R = (
  normalizeFacet: string[],
  modeA: EventFlowRow['modeA'],
  desktop: EventFlowRow['desktop'],
  tui: EventFlowRow['tui'],
  note?: string,
): EventFlowRow => ({ normalizeFacet, modeA, desktop, tui, ...(note ? { note } : {}) });

export const EVENT_FLOW_MATRIX: Record<string, EventFlowRow> = {
  // ---- 会话生命周期 ----
  'session.created':      R([], 'passthrough', 'handled', 'ignore', 'desktop 走 planSessionEvent invalidate'),
  'session.updated':      R([], 'passthrough', 'handled', 'ignore', 'desktop patch 标题/时间；pi agent_start 映射为此（空壳无 info，planner 忽略）'),
  'session.deleted':      R([], 'passthrough', 'handled', 'ignore', 'desktop remove + closeSession'),
  'session.idle':         R(['chatSignal', 'broadcast'], 'rewrite', 'handled', 'handled', 'Mode A 改写为 message.complete；desktop 的 session.idle 分支是防御性兜底'),
  'session.error':        R(['chatSignal', 'broadcast'], 'rewrite', 'handled', 'handled', 'Mode A 改写为 message.error'),
  'session.compacting':   R(['compaction'], 'passthrough', 'ignore', 'ignore', '仅 pi 发；gateway 触发 turnCompress flush'),
  'session.compacted':    R(['compaction'], 'passthrough', 'handled', 'ignore', 'desktop 记录 compactionMarks'),
  // ---- 消息流 ----
  'message.updated':      R(['step', 'chatSignal'], 'passthrough', 'handled', 'ignore', 'desktop 建消息骨架/替换乐观 user 消息'),
  'message.part.updated': R(['step', 'chatSignal', 'toolCommand'], 'passthrough', 'handled', 'handled', '最高频事件'),
  'message.part.delta':   R([], 'passthrough', 'handled', 'ignore', 'opencode ≥1.18 流式增量'),
  'message.complete':     R([], 'passthrough', 'handled', 'handled', 'Mode A 由 session.idle 改写而来'),
  'message.part.complete':R([], 'passthrough', 'handled', 'ignore', ''),
  'message.error':        R(['chatSignal'], 'passthrough', 'handled', 'ignore', 'session.error 在 Mode A 改写为本事件；自身 broadcast=passthrough 另有透传（双发）'),
  'message.aborted':      R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- 问答/审批 ----
  'question.asked':       R([], 'passthrough', 'handled', 'ignore', 'desktop flow card'),
  'question.replied':     R([], 'passthrough', 'handled', 'ignore', ''),
  'question.rejected':    R([], 'passthrough', 'handled', 'ignore', ''),
  'permission.asked':     R([], 'passthrough', 'handled', 'handled', 'TUI 有 once/always/reject overlay'),
  'permission.replied':   R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- 数据面 ----
  'todo.updated':         R([], 'passthrough', 'handled', 'ignore', ''),
  'trajectory.event':     R([], 'passthrough', 'handled', 'ignore', 'desktop 滚动窗口 200'),
  'trajectory.turn':      R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- legacy/internal ----
  'session.next.step.ended':     R(['step'], 'passthrough', 'ignore', 'ignore', 'legacy 兜底（opencode <1.18）'),
  'session.next.reasoning.ended':R([], 'passthrough', 'ignore', 'ignore', '插件 obs 捕获用，客户端不消费'),
  'session.next.tool.failed':    R([], 'passthrough', 'ignore', 'ignore', '插件 obs 捕获用'),
  // ---- 扁平顶层广播 ----
  'user_question':              R([], 'passthrough', 'handled', 'ignore', 'desktop setActiveQuestion + 通知'),
  'user_feedback':              R([], 'passthrough', 'ignore', 'ignore', ''),
  'goal_created':               R([], 'passthrough', 'ignore', 'ignore', 'desktop Goals 页 15s 轮询'),
  'state_change':               R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'phase_transition':           R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'memory_written':             R([], 'passthrough', 'ignore', 'ignore', ''),
  'memory_energy_changed':      R([], 'passthrough', 'ignore', 'ignore', ''),
  'memory_distillation_complete':R([], 'passthrough', 'ignore', 'ignore', ''),
  'automation_triggered':       R([], 'passthrough', 'ignore', 'ignore', 'Automations 页 10s 轮询'),
  'automation_completed':       R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'project_registered':         R([], 'passthrough', 'handled', 'ignore', 'desktop projectsRev++ 重拉 Rail'),
  'runtime_switched':           R([], 'passthrough', 'handled', 'ignore', 'desktop 重置 chat workspace'),
  'mafw_commands_changed':      R([], 'passthrough', 'ignore', 'ignore', 'desktop ChatPane 另行消费补全'),
};

const VALID_MODE_A = new Set(['passthrough', 'rewrite', 'drop']);
const VALID_CONSUMPTION = new Set(['handled', 'ignore']);

/** 返回矩阵完整性的问题列表；空数组 = 通过。 */
export function assertMatrixComplete(): string[] {
  const issues: string[] = [];
  for (const [type, row] of Object.entries(EVENT_FLOW_MATRIX)) {
    if (!Array.isArray(row.normalizeFacet)) issues.push(`${type}: normalizeFacet must be an array`);
    if (!VALID_MODE_A.has(row.modeA)) issues.push(`${type}: invalid modeA '${row.modeA}'`);
    if (!VALID_CONSUMPTION.has(row.desktop)) issues.push(`${type}: invalid desktop '${row.desktop}'`);
    if (!VALID_CONSUMPTION.has(row.tui)) issues.push(`${type}: invalid tui '${row.tui}'`);
  }
  return issues;
}
