/**
 * TUI agent 选择项（opencode 2.1.0 契约）。
 *
 * 运行时 agent 是 { id, name, hidden }：value（发给 promptAsync 的稳定标识）
 * 用 id，label（列表展示）用 name。MAFW 注册表身份只有 name，回退 name。
 */
export type AgentRow = {
  id?: string
  name?: string
  description?: string
  mode?: string
  hidden?: boolean
}

export type AgentSelectItem = {
  value: string
  label: string
  description: string
}

export function agentSelectItems(agents: AgentRow[]): AgentSelectItem[] {
  const out: AgentSelectItem[] = []
  for (const a of agents || []) {
    if (!a || a.hidden) continue
    const value = String(a.id || a.name || '').trim()
    if (!value) continue
    out.push({
      value,
      label: String(a.name || a.id || value),
      description: a.description || String(a.mode ?? ''),
    })
  }
  return out
}
