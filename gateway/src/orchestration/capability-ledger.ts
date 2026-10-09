// L1 能力账本 + L2 失败谱：goal_outcomes 与蒸馏产物的确定性聚合（零 LLM）。
// 回答"我擅长什么 / 我反复踩什么坑"，供 <agent-priors> 与 plan 节点消费。
// 任务类型分桶是已知缺口（goal 无类型维度）——v1 用 verdict/failure_kind 维度。

export interface LedgerOutcome {
  goal_id: string;
  verdict: string;
  rounds?: number;
  total_cost?: number | null;
  thumbs_up?: number;
  thumbs_down?: number;
  failure_kind?: string | null;
}

export interface CapabilityLedger {
  total: number;
  passRate: number;
  avgRounds: number;
  avgCostUsd: number;
  thumbsUp: number;
  thumbsDown: number;
  byFailureKind: Record<string, number>;
}

export function buildCapabilityLedger(outcomes: LedgerOutcome[]): CapabilityLedger {
  const total = outcomes.length;
  const byFailureKind: Record<string, number> = {};
  let passes = 0;
  let sumRounds = 0;
  let sumCost = 0;
  let up = 0;
  let down = 0;
  for (const o of outcomes) {
    if (o.verdict === 'PASS') passes++;
    sumRounds += o.rounds ?? 0;
    sumCost += o.total_cost ?? 0;
    up += o.thumbs_up ?? 0;
    down += o.thumbs_down ?? 0;
    if (o.failure_kind) byFailureKind[o.failure_kind] = (byFailureKind[o.failure_kind] ?? 0) + 1;
  }
  return {
    total,
    passRate: total ? passes / total : 0,
    avgRounds: total ? sumRounds / total : 0,
    avgCostUsd: total ? sumCost / total : 0,
    thumbsUp: up,
    thumbsDown: down,
    byFailureKind,
  };
}
