import type { MafwAgent } from '@mafw/sdk'
import { normalizeAgents } from '../store/dto.ts'

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

/** picker 首行：会话默认 agent（null = runtime 默认）。 */
export const DEFAULT_AGENT_ITEM: AgentSelectItem = {
  value: '__default__',
  label: '默认',
  description: 'runtime 默认 agent',
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

/**
 * gateway `/api/agents` 原始响应 → picker 行（默认行 + 可选 agent）。
 *
 * `client.agents.list()` 已经解包为数组；这里同时容忍 `{items}` 信封，但
 * **不假设**信封存在（Task 12 review I1：旧 wiring 读 `.items` 导致永远为空）。
 */
export function agentPickerItems(raw: unknown): AgentSelectItem[] {
  return [{ ...DEFAULT_AGENT_ITEM }, ...agentSelectItems(normalizeAgents(raw))]
}

export interface AgentPickerDeps {
  /** 取 gateway agent 列表（数组或 `{items}` 信封）。 */
  load: () => Promise<unknown>
  /** 打开 picker（app 层注入 SelectList/modal；测试注入捕获器）。 */
  pick: (items: AgentSelectItem[]) => void | Promise<void>
}

/**
 * `/agent` picker 的接线单元：加载 → 归一 → 非空才打开。
 * 空列表返回中性提示；加载失败不抛给 UI。
 */
export async function showAgentPickerWith(deps: AgentPickerDeps): Promise<string | null> {
  let items: AgentSelectItem[]
  try {
    items = agentPickerItems(await deps.load())
  } catch {
    return '无法获取 agent 列表'
  }
  if (items.length <= 1) return '无可用 agent（runtime 未提供）'
  await deps.pick(items)
  return null
}
