import type { PodGoal } from "@mafw/sdk"

export type AgentContract = {
  level: 3 | 4
  levelLabel: string
  mandate: string
  discretion: string
  escalation: readonly string[]
  audit: readonly string[]
  humanOnly: readonly string[]
}

/** Agent 可见契约：授权级别 + 四个参数 + 永不由 Agent 承担的人类边界。 */
export function agentContractFor(
  goal: Pick<PodGoal, "goalMode" | "stage" | "progress" | "lastError" | "accepted">,
): AgentContract {
  const level = goal.goalMode === "quick" || goal.goalMode === "standing" ? 4 : 3
  return {
    level,
    levelLabel: level === 4 ? "授权内自主" : "批准后执行",
    mandate: `在 ${goal.goalMode ?? "standard"} 范围内推进当前 Goal`,
    discretion: level === 4
      ? "可逆、低风险步骤自主，事后报告"
      : "计划内自主，计划批准后执行",
    escalation: [
      "计划外写",
      "删除",
      "网络 / 外部副作用",
      "超预算",
      "验收",
      "合并",
      "解决评审项",
    ],
    audit: ["计划与 Goal Eval", "变更集", "评审项", "决定记录"],
    humanOnly: ["验收", "合并", "解决评审项", "5 自决永远不允许"],
  }
}
