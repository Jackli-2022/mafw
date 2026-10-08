// gateway/src/core/goal/routing.ts
// 路由纯函数——从 core/langgraph/graph.ts:4-15 移植（langgraph 退役，语义逐字保留）。

export type GoalNodeName =
  | 'plan' | 'execute' | 'review' | 'askUser'
  | 'archive_success' | 'archive_fail' | 'archive_max_retries';

export interface RouteState {
  lastError: string | null;
  reviewVerdict: 'PASS' | 'FAIL' | 'ERROR' | null;
  round: number;
  maxRounds: number;
  pendingQuestion: unknown;
}

export type RouteStage = 'start' | 'after_plan' | 'after_execute' | 'after_review';

export function routeAfterPlan(s: RouteState): GoalNodeName {
  if (s.pendingQuestion) return 'askUser';
  return 'execute';
}

export function routeAfterReview(s: RouteState): GoalNodeName {
  if (s.lastError) return 'archive_fail';
  if (s.reviewVerdict === 'PASS') return 'archive_success';
  if (s.round >= s.maxRounds) return 'archive_max_retries';
  if (s.pendingQuestion) return 'askUser';
  return 'plan';
}

export function routeNext(stage: RouteStage, s: RouteState): GoalNodeName {
  switch (stage) {
    case 'start': return 'plan';
    case 'after_plan': return routeAfterPlan(s);
    case 'after_execute': return 'review';
    case 'after_review': return routeAfterReview(s);
  }
}
