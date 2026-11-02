import type { MafwAgent } from '@mafw/sdk'

/**
 * TUI agent 选择项（Task 12）：只消费中性 `MafwAgent`。
 *
 * `value` = agent id（发给 promptAsync 的稳定标识），`label` = 展示名；
 * 是否可选出 `selectable` 决定，不在 UI 里按 runtime 名/原生 hidden 判断。
 */
export type AgentSelectItem = {
  value: string
  label: string
  description: string
}

export function agentSelectItems(agents: MafwAgent[]): AgentSelectItem[] {
  const out: AgentSelectItem[] = []
  for (const agent of agents || []) {
    if (!agent || !agent.selectable) continue
    const value = String(agent.id || '').trim()
    if (!value) continue
    out.push({
      value,
      label: String(agent.label || value),
      description: agent.description || agent.mode || '',
    })
  }
  return out
}
