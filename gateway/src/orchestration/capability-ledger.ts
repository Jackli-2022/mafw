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

export interface FailurePattern {
  pattern: string;
  count: number;
  energy: number;
  id: string;
}

/**
 * L2 失败谱：把 `cat:failure`/`cat:correction` 蒸馏产物按 primary_abstraction
 * 聚类（同文本合并计数），组内最高能条目作代表；未 superseded。供 plan 风险清单
 * 与 <agent-priors> 消费。按频次降序。
 */
export function buildFailureTaxonomy(entries: Array<{
  id: string;
  energy?: number;
  primary_abstraction?: string;
  cue_anchors?: string[];
  superseded_by?: string;
}>): FailurePattern[] {
  const groups = new Map<string, FailurePattern>();
  for (const e of entries) {
    if (e.superseded_by) continue;
    const anchors = e.cue_anchors ?? [];
    if (!anchors.includes('cat:failure') && !anchors.includes('cat:correction')) continue;
    const pattern = e.primary_abstraction ?? e.id;
    const g = groups.get(pattern);
    const energy = e.energy ?? 0;
    if (g) {
      g.count++;
      if (energy > g.energy) {
        g.energy = energy;
        g.id = e.id;
      }
    } else {
      groups.set(pattern, { pattern, count: 1, energy, id: e.id });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
