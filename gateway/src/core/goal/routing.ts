// gateway/src/core/goal/routing.ts
// 路由纯函数——从 core/langgraph/graph.ts:4-15 移植（langgraph 退役，语义逐字保留）。
// 节点词汇见 node-names.ts（`GoalNodeName` 在此 re-export，保持既有 import 兼容）。
import type { GoalNodeName } from './node-names';

export type { GoalNodeName } from './node-names';

export interface RouteState {
  lastError: string | null;
  reviewVerdict: 'PASS' | 'FAIL' | 'ERROR' | null;
  round: number;
  maxRounds: number;
  pendingQuestion: unknown;
  /** W1：manual 批准门（driver 组装：planReview==='manual' 且本版计划成功）。 */
  planReviewGate?: boolean;
  /** Task 14：本版计划返回 need_probe（还有待跑探针）→ 先 Spike，再重新规划。 */
  probeNeeded?: boolean;
  /** 同轮复核：本轮还没用过复核（FAIL 时优先回 execute 修复，而不是下一轮 plan）。 */
  reviewFixAvailable?: boolean;
}

export type RouteStage = 'start' | 'after_plan' | 'after_probe' | 'after_execute' | 'after_review';

export function routeAfterPlan(s: RouteState): GoalNodeName {
  if (s.pendingQuestion) return 'askUser';
  // 探针先于一切实施动作：没有最终 ready 计划就不可能有批准，更不可能执行。
  if (s.probeNeeded) return 'probe';
  if (s.planReviewGate) return 'await_plan_approval';
  return 'execute';
}

export function routeAfterReview(s: RouteState): GoalNodeName {
  if (s.lastError) return 'archive_fail';
  if (s.reviewVerdict === 'PASS') return 'archive_success';
  // 同轮复核：不消耗 round，所以优先于 maxRounds 判定
  if (s.reviewFixAvailable) return 'execute';
  if (s.round >= s.maxRounds) return 'archive_max_retries';
  if (s.pendingQuestion) return 'askUser';
  return 'plan';
}

export function routeNext(stage: RouteStage, s: RouteState): GoalNodeName {
  switch (stage) {
    case 'start': return 'plan';
    case 'after_plan': return routeAfterPlan(s);
    // Spike 报告也是计划输入：验完必须回到 Tech Lead 重新规划（不是直接实施）。
    case 'after_probe': return 'plan';
    case 'after_execute': return 'review';
    case 'after_review': return routeAfterReview(s);
  }
}
