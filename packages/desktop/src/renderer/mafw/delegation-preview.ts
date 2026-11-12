export type DelegationPreviewInput = {
  projectName: string
  title: string
  objective: string
  acceptance: readonly string[]
  boundaries: readonly string[]
  planReview: "auto" | "manual"
}

export type DelegationPreview = {
  principal: string
  agent: string
  scope: string
  intent: string
  constraints: string
  acceptance: string
  discretion: string
  escalation: string
  budget: string
  evidence: string
  termination: string
  audit: string
  autonomy: { level: 3 | 5; label: string; note: string }
}

function joined(lines: readonly string[], separator = "；"): string {
  return lines.map((line) => line.trim()).filter(Boolean).join(separator)
}

/** 委托单是 Goal 的承诺视图；授权级别只做显示，本轮不新增运行时策略引擎。 */
export function buildDelegationPreview(input: DelegationPreviewInput): DelegationPreview {
  const title = input.title.trim()
  const objective = input.objective.trim()
  const acceptance = joined(input.acceptance)
  const boundaries = joined(input.boundaries)
  return {
    principal: "你（项目所有者）",
    agent: "Tech Lead",
    scope: `${input.projectName.trim() || "当前项目"} · 当前项目 · 不跨世界`,
    intent: objective ? `${title}：${objective}` : title,
    constraints: boundaries || "未声明（计划批准时确认）",
    acceptance: acceptance || "由 Tech Lead 提议，计划批准时确认",
    discretion: "计划内自主；计划外写、删除、网络与超预算必须升级",
    escalation: "计划外写 / 删除 / 网络 / 超预算 / 验收 / 合并 / 解决评审项",
    budget: "未设置",
    evidence: "计划、变更集、评审项、Goal Eval",
    termination: "结果待验收，或你中止",
    audit: "决定记录 + Goal 历史",
    autonomy: {
      level: 3,
      label: "批准后执行",
      note: "计划批准后 Tech Lead 才执行；验收、合并与评审项解决永远由人完成。",
    },
  }
}
