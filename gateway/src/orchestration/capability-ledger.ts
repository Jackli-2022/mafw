// L1 能力账本 + L2 失败谱：goal_outcomes 与蒸馏产物的确定性聚合（零 LLM）。
// 回答"我擅长什么 / 我反复踩什么坑"，供 <agent-priors> 与 plan 节点消费。
// D4b：goal 增 taskType 维度（创建时声明 + plan 节点回写，规划者优先）。

/** D4b 任务类型枚举（plan 节点判断优先于创建时声明）。 */
export const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'research', 'docs', 'test', 'other'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export function isTaskType(v: unknown): v is TaskType {
  return typeof v === 'string' && (TASK_TYPES as readonly string[]).includes(v);
}

export interface LedgerOutcome {
  goal_id: string;
  verdict: string;
  rounds?: number;
  total_cost?: number | null;
  thumbs_up?: number;
  thumbs_down?: number;
  failure_kind?: string | null;
  /** D4b: null = legacy rows → pool into the global bucket. */
  task_type?: string | null;
}

export interface TaskLedger {
  total: number;
  passRate: number;
  avgRounds: number;
  avgCostUsd: number;
}

export interface CapabilityLedger extends TaskLedger {
  thumbsUp: number;
  thumbsDown: number;
  byFailureKind: Record<string, number>;
  /** D4b: per-task-type aggregation for the counterfactual prior. */
  byTaskType: Record<string, TaskLedger>;
}

function aggregate(outcomes: LedgerOutcome[]): TaskLedger {
  const total = outcomes.length;
  let passes = 0;
  let sumRounds = 0;
  let sumCost = 0;
  for (const o of outcomes) {
    if (o.verdict === 'PASS') passes++;
    sumRounds += o.rounds ?? 0;
    sumCost += o.total_cost ?? 0;
  }
  return {
    total,
    passRate: total ? passes / total : 0,
    avgRounds: total ? sumRounds / total : 0,
    avgCostUsd: total ? sumCost / total : 0,
  };
}

export function buildCapabilityLedger(outcomes: LedgerOutcome[]): CapabilityLedger {
  const byFailureKind: Record<string, number> = {};
  const byTaskTypeRaw = new Map<string, LedgerOutcome[]>();
  let up = 0;
  let down = 0;
  for (const o of outcomes) {
    up += o.thumbs_up ?? 0;
    down += o.thumbs_down ?? 0;
    if (o.failure_kind) byFailureKind[o.failure_kind] = (byFailureKind[o.failure_kind] ?? 0) + 1;
    const tt = o.task_type ?? 'other';
    const arr = byTaskTypeRaw.get(tt) ?? [];
    arr.push(o);
    byTaskTypeRaw.set(tt, arr);
  }
  const byTaskType: Record<string, TaskLedger> = {};
  for (const [tt, arr] of byTaskTypeRaw) byTaskType[tt] = aggregate(arr);
  return {
    ...aggregate(outcomes),
    thumbsUp: up,
    thumbsDown: down,
    byFailureKind,
    byTaskType,
  };
}

/** D4b: ledger for one task type — bucket only with >=3 samples, else pool to
 *  global (two bugfix failures do not prove bugfixes always fail). */
export function ledgerForTaskType(
  outcomes: LedgerOutcome[],
  taskType: string,
): TaskLedger & { source: 'task' | 'global' } {
  const same = outcomes.filter((o) => (o.task_type ?? 'other') === taskType);
  if (same.length >= 3) return { ...aggregate(same), source: 'task' };
  return { ...aggregate(outcomes), source: 'global' };
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

/**
 * W4：把能力账本 + 失败谱渲染为注入 plan 节点 prompt 的"行动先验"块。
 * 规划时看到自己在同类任务上的历史与反复失败模式，主动规避。空账本返回 ''。
 */
export function capabilityPriorBlock(ledger: CapabilityLedger, taxonomy: FailurePattern[]): string {
  if (ledger.total === 0 && taxonomy.length === 0) return '';
  const lines: string[] = ['### 你在此类任务上的历史（自我认知账本）'];
  if (ledger.total > 0) {
    lines.push(
      `- 历史 PASS 率 ${Math.round(ledger.passRate * 100)}%（${ledger.total} 个 goal），` +
        `平均 ${ledger.avgRounds.toFixed(1)} 轮，平均成本 $${ledger.avgCostUsd.toFixed(2)}`,
    );
  }
  if (taxonomy.length > 0) {
    lines.push('- 反复失败模式（计划时主动回避）：');
    for (const t of taxonomy.slice(0, 5)) lines.push(`  - [×${t.count}] ${t.pattern}`);
  }
  return lines.join('\n');
}

/**
 * D4b 反事实推演（pre-mortem）：把同任务类型的失败历史渲染为「若失败会怎样」。
 * 有 outcome → 失败率/最常见失败 kind/平均损失；taxonomy → 历史踩坑对照。
 * 反事实要求（每 wave 附 riskNote）不依赖历史数据——空账本也发射要求。
 * `counterfactualPromptBlock` 是兼容别名（接线早期名字）。
 */
export function counterfactualBlock(
  opts: { taskType: string },
  outcomes: LedgerOutcome[],
  taxonomy: FailurePattern[],
): string {
  const lines: string[] = [`### 反事实推演（pre-mortem）——若此任务失败，最可能的形态`];
  const ledger = ledgerForTaskType(outcomes, opts.taskType);
  if (ledger.total > 0) {
    const failRate = 1 - ledger.passRate;
    lines.push(
      `- ${ledger.source === 'task' ? '同类任务' : '全部任务'}（${opts.taskType}${ledger.source === 'global' ? ' 样本不足，退全局' : ''}）` +
        `历史失败率 ${Math.round(failRate * 100)}%（N=${ledger.total}），平均 ${ledger.avgRounds.toFixed(1)} 轮 / $${ledger.avgCostUsd.toFixed(2)}`,
    );
    const kinds: Record<string, number> = {};
    for (const o of outcomes) {
      if (o.verdict !== 'PASS' && o.failure_kind) kinds[o.failure_kind] = (kinds[o.failure_kind] ?? 0) + 1;
    }
    const topKinds = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (topKinds.length > 0) {
      lines.push(`- 最常见失败：${topKinds.map(([k, n]) => `${k}（×${n}）`).join('、')}`);
    }
  } else {
    lines.push('- 无同类历史数据——按最坏情况预设缓解');
  }
  if (taxonomy.length > 0) {
    lines.push('- 历史踩坑对照（为每个 wave 预设缓解）：');
    for (const t of taxonomy.slice(0, 5)) lines.push(`  - [×${t.count}] ${t.pattern}`);
  }
  lines.push('要求：每个 wave 附 `riskNote`——一句话「此 wave 最可能的失败 + 对应缓解」。');
  return lines.join('\n');
}

export const counterfactualPromptBlock = counterfactualBlock;
