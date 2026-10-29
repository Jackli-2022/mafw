/**
 * 事件链路矩阵 —— 每个 canonical 事件在每一跳的消费处置，显式声明。
 *
 * 列：
 *   normalizeFacet — gateway canonical-facets.ts 抽出的切面（step/chatSignal/compaction/toolCommand），空数组 = 仅透传
 *   modeA          — Mode A 全局广播处置：passthrough 原样 / rewrite 改写 / drop 不广播
 *   desktop / tui  — 客户端消费：handled = 有分支；ignore = 显式不消费（有意）
 *
 * 新增事件类型时必须在此加行（SDK union 扩展 → 遍历测试变红指向本文件），
 * 填每一格时即完成"这个事件每一跳怎么办"的通盘思考。
 * 事件清单的单一事实源在 packages/gateway-sdk/src/events.ts（本文件经测试
 * 与其交叉校验，不直接 import 以免 gateway 依赖 SDK 源码）；gateway 侧常量
 * 镜像在 ./mafw-vocabulary.ts（vocabulary-sync.test.ts 双向钉扎）。
 *
 * v2（2026-10-12）：turn 三元组取代 session.idle/message.complete/error/aborted
 * 双轨，Mode A 改写 hack 已删除（广播统一 passthrough，turn.failed 保留 error
 * 字段提取）；part.* 去前缀；todo.updated → plan.updated；usage.updated 新增。
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
  // ---- 回合生命周期（v3 增 turn.started；终态三元组 v2 起统一 passthrough） ----
  'turn.started':        R([], 'passthrough', 'ignore', 'ignore', 'v3 新增：回合起始（opencode@v2 session.next.prompted / pi agent_start / codex turn/started / dsh turn/start）；消费方接线下再升 handled'),
  'turn.completed':       R(['chatSignal'], 'passthrough', 'handled', 'handled', 'opencode session.idle / pi agent_end 翻译而来；trajectory turn 聚合 + usage 合成挂此'),
  'turn.failed':          R(['chatSignal'], 'passthrough', 'handled', 'handled', 'session.error + message.error 双发合并到此；广播带 error 字段提取（消费方错误展示契约）'),
  'turn.aborted':         R([], 'passthrough', 'handled', 'ignore', '原 message.aborted'),
  'session.compacting':   R(['compaction'], 'passthrough', 'ignore', 'ignore', '仅 pi 发；gateway 触发 turnCompress flush'),
  'session.compacted':    R(['compaction'], 'passthrough', 'handled', 'ignore', 'desktop 记录 compactionMarks'),
  // ---- 消息/part 流 ----
  'message.updated':      R(['step', 'chatSignal'], 'passthrough', 'handled', 'ignore', 'desktop 建消息骨架/替换乐观 user 消息'),
  'part.updated':         R(['step', 'chatSignal', 'toolCommand'], 'passthrough', 'handled', 'handled', '原 message.part.updated；最高频事件；toolCommand 载体（tool part 快照 state.input.command）'),
  'part.delta':           R([], 'passthrough', 'handled', 'ignore', '原 message.part.delta；opencode ≥1.18 流式增量'),
  'part.complete':        R([], 'passthrough', 'handled', 'ignore', '原 message.part.complete'),
  // ---- 问答/审批 ----
  'question.asked':       R([], 'passthrough', 'handled', 'ignore', 'desktop flow card'),
  'question.replied':     R([], 'passthrough', 'handled', 'ignore', ''),
  'question.rejected':    R([], 'passthrough', 'handled', 'ignore', ''),
  'permission.asked':     R([], 'passthrough', 'handled', 'handled', 'v2 载荷可选 options[]（服务端决策集）/suggestedRule（服务端起草规则）；TUI 有 once/always/reject overlay'),
  'permission.replied':   R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- 数据面 ----
  'plan.updated':         R([], 'passthrough', 'handled', 'ignore', '原 todo.updated；ACP plan / codex todo_list 同域'),
  'usage.updated':        R([], 'passthrough', 'ignore', 'ignore', 'v2 新增：gateway 在 turn 聚合后从 TrajectoryTurn tokens/cost 合成'),
'queue.updated':        R([], 'passthrough', 'ignore', 'ignore', '队列 inbox 事件：gateway 在 enqueue/dequeue/cancel/clear/expire 时广播（items 全量快照，经 event_log 持久化）'),
  'task.updated':         R([], 'passthrough', 'handled', 'ignore', 'Batch 4：gateway 持久任务状态变化（顶层广播，desktop task-store/BackgroundDock 消费）'),
  'pod.updated':          R([], 'passthrough', 'handled', 'ignore', 'Project Pod Lite：成员/任务/消息/记忆变更（gateway 自发；desktop Pod 面板刷新）'),
  'session.config':       R([], 'passthrough', 'ignore', 'ignore', 'Batch 7：会话配置选项变更（mode/agent/model/model_config/thought_level；gateway 顶层广播）'),
  'session.checkpoint':   R([], 'passthrough', 'ignore', 'ignore', 'T2-1：检查点创建（ gateway 自发，auto/manual；desktop overlay 拉取式消费）'),
  'run.updated':          R([], 'passthrough', 'handled', 'ignore', 'T2-2：回合软暂停状态（suspended/resumed/completed/failed/cancelled；gateway 自发；desktop run-store 消费）'),
  'trajectory.event':     R([], 'passthrough', 'handled', 'ignore', 'desktop 滚动窗口 200'),
  'trajectory.turn':      R([], 'passthrough', 'handled', 'ignore', ''),
  // ---- 能力面 ----
  'permission_mode':      R([], 'passthrough', 'handled', 'handled', 'gateway 自发（审批三档预设变更）；desktop flow-cards/TUI 状态栏消费'),
  'session.diff':         R([], 'passthrough', 'handled', 'ignore', 'opencode v2 会话文件变更（diffApi）；desktop diff handler 实时填充'),
  'session.commands':     R([], 'passthrough', 'ignore', 'ignore', 'T2-5 命令发现快照；skills/AGENTS pull-only；desktop UI 采用后续'),
  'connected':            R([], 'passthrough', 'handled', 'ignore', 'SSE 建连/重连问候帧（gateway 直发，非 runtime 事件）；desktop dispatcher 消费防 miss'),
  // ---- 扁平顶层广播 ----
  'user_question':              R([], 'passthrough', 'handled', 'ignore', 'desktop setActiveQuestion + 通知'),
  'user_feedback':              R([], 'passthrough', 'ignore', 'ignore', ''),
  'goal_created':               R([], 'passthrough', 'handled', 'ignore', 'desktop goalsRev（dispatcher goal 分支，P2 起消费）'),
  'state_change':               R([], 'passthrough', 'ignore', 'ignore', ''),
  'phase_transition':           R([], 'passthrough', 'handled', 'ignore', 'desktop goalsRev（dispatcher goal 分支，P2 起消费）'),
  'memory_written':             R([], 'passthrough', 'ignore', 'ignore', ''),
  'memory_energy_changed':      R([], 'passthrough', 'ignore', 'ignore', ''),
  'memory_distillation_complete':R([], 'passthrough', 'ignore', 'ignore', ''),
  'automation_triggered':       R([], 'passthrough', 'ignore', 'ignore', 'Automations 页 10s 轮询'),
  'automation_completed':       R([], 'passthrough', 'ignore', 'ignore', '同上'),
  'project_registered':         R([], 'passthrough', 'handled', 'ignore', 'desktop projectsRev++ 重拉 Rail'),
  'runtime_switched':           R([], 'passthrough', 'handled', 'ignore', 'desktop 重置 chat workspace'),
  'mafw_commands_changed':      R([], 'passthrough', 'ignore', 'ignore', 'desktop ChatPane 另行消费补全'),
  'goal_node':                  R([], 'passthrough', 'handled', 'ignore', 'goal 编排节点事件（无 sessionID，sid 分发前消费）；desktop goalsRev 泳道刷新'),
};

const VALID_MODE_A = new Set(['passthrough', 'rewrite', 'drop']);
const VALID_CONSUMPTION = new Set(['handled', 'ignore']);

/**
 * runtime 原生但**不进客户端契约**的事件类型 —— gateway 边界直接丢弃。
 *
 * `sync`：opencode v2 事件溯源信封 `{type:'sync', syncEvent:{type:'*.1',
 * seq, aggregateID, data}}`（session/message/session.next 全族），opencode
 * 自家客户端的状态重同步传输，与 legacy/dedicated 事件**双发**。MAFW 三端消费
 * legacy/dedicated 事件即可：放行只会造成重复处理、desktop miss 告警与
 * [SSE] 日志刷屏。刻意不进 EVENT_FLOW_MATRIX（canonical 契约的单表）——
 * 这些类型永远不到客户端。opencode 翻译表（opencode-events.ts 的
 * transformEvent）同时按前缀丢弃 session.next.* legacy 族。
 * 若未来 opencode 移除 legacy 双发，应在翻译层把 syncEvent 翻译为
 * canonical 形状，而非放行原始信封。
 */
export const RUNTIME_NATIVE_DROPPED: ReadonlySet<string> = new Set(['sync']);

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
