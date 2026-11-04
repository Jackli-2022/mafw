/**
 * agent 身份层（View DTO 的 id/label 双字段）。
 *
 * `MafwAgent`：`id` 是稳定标识，`label` 只是显示名（`name` 为旧形状兼容）。
 * MAFW 注册表身份可能只有 `name`。会话上的 `session.agent` 持久化为 runtime 的 id。
 *
 * 统一规则：`agentKey = id ?? name`（选人/发 prompt/会话状态比较一律用 key），
 * `agentLabel = label ?? name ?? id`（只用于展示）。历史会话可能把显示名写进
 * session.agent（旧前端按 name 发送），resolveSessionAgent 做大小写与显示名回退。
 */
export type AgentLike = {
  id?: string
  name?: string
  /** 规范 `MafwAgent.label`（展示名）；旧形状用 name 兼作展示名。 */
  label?: string
  mode?: string
  hidden?: boolean
  source?: string
  description?: string
  color?: string
  isManager?: boolean
}

export function agentKey(a: AgentLike | null | undefined): string {
  return a?.id || a?.name || ""
}

export function agentLabel(a: AgentLike | null | undefined): string {
  return a?.label || a?.name || a?.id || ""
}

export function isAgentKey(a: AgentLike | null | undefined, key: string): boolean {
  return agentKey(a).toLowerCase() === String(key).toLowerCase()
}

/** 把 session.agent（id / 旧版显示名 / 任意大小写）解析为列表里的 agent。 */
export function resolveSessionAgent<T extends AgentLike>(
  agents: T[],
  value: unknown,
): T | null {
  if (typeof value !== "string" || !value) return null
  const needle = value.toLowerCase()
  return (
    agents.find((a) => agentKey(a).toLowerCase() === needle) ??
    agents.find((a) => agentLabel(a).toLowerCase() === needle) ??
    null
  )
}
