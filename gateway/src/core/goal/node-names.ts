// gateway/src/core/goal/node-names.ts
// Goal 节点词汇的单一来源（Task 12）。避免 driver / node-prompts / routing 各自
// 手写 `'plan' | 'execute' | 'review'` 联合类型漂移；Task 14 在此追加 probe 节点。
//
// 注意：`GoalNodeName` 是**路由目标**（含 askUser / archive* 等非执行节点），
// `ExecutableGoalNode` 是**需要 runtime 会话**的节点。两者刻意分开——只有后者
// 会创建/复用会话、跑 prompt、产出 artifact。

/** 需要 runtime 会话的节点（Task 14 增加 probe）。 */
export type ExecutableGoalNode = 'plan' | 'probe' | 'execute' | 'review';

export const EXECUTABLE_GOAL_NODES: readonly ExecutableGoalNode[] = ['plan', 'probe', 'execute', 'review'];

/** 全量路由目标（routing.ts 的返回类型）。 */
export type GoalNodeName =
  | ExecutableGoalNode
  | 'askUser'
  | 'await_plan_approval'
  | 'archive_success' | 'archive_fail' | 'archive_max_retries';

export function isExecutableGoalNode(value: unknown): value is ExecutableGoalNode {
  return typeof value === 'string'
    && (EXECUTABLE_GOAL_NODES as readonly string[]).includes(value);
}

/**
 * IdentityRegistry 物化名（`mafw-plan` / `mafw-probe` / `mafw-execute` / `mafw-review`）。
 *
 * Spike 由 Builder 执行（spec §6：Builder 执行 Probe 并返回 ProbeReport）——probe 节点
 * 没有独立身份，直接复用 `mafw-execute` 的 Builder 身份与工具权限。
 */
export function goalAgentName(node: ExecutableGoalNode): string {
  return node === 'probe' ? 'mafw-execute' : `mafw-${node}`;
}

/** 执行节点中文标签（timeline / 提示词共用）。 */
export const GOAL_NODE_LABELS: Record<ExecutableGoalNode, string> = {
  plan: '规划',
  probe: '验证',
  execute: '执行',
  review: '评审',
};

export function goalNodeLabel(node: ExecutableGoalNode): string {
  return GOAL_NODE_LABELS[node];
}
