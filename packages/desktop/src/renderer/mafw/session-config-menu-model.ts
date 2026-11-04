// 会话配置菜单的纯模型：pill 偏差徽标、档位列表、Agent 切换选项。
// 契约：Agent 选项 / 默认 agent / 规划 agent 一律来自 MafwAgent DTO
// （source/selectable/default/planning），前端不按 runtime 原生 agent 名分支。
import type { ThinkingLevel } from "@mafw/sdk"
import { agentKey, agentLabel, isAgentKey, type AgentLike } from "./agent-identity"

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Thinking 子菜单项：默认（null = 清除存储档位）在前，其后七档。 */
export const THINKING_MENU_OPTIONS: Array<{ id: ThinkingLevel | null; label: string }> = [
  { id: null, label: "默认" },
  ...THINKING_LEVELS.map((level) => ({ id: level, label: level })),
]

type AgentRow = AgentLike & {
  selectable?: boolean
  default?: boolean
  planning?: boolean
}

export type AgentOption = { id: string; label: string; hint?: string }

/** runtime 原生、用户可切换的 agent（MAFW 身份由 Pod / Creator 入口管理）。 */
export function isRuntimeAgent(agent: AgentRow | null | undefined): boolean {
  return agent?.source === "runtime" && agent.selectable !== false && !!agentKey(agent)
}

/** 菜单顺序：默认 agent 置顶，其余沿用 DTO 顺序。 */
export function orderedRuntimeAgents<T extends AgentRow>(agents: T[]): T[] {
  const runtime = (agents || []).filter(isRuntimeAgent)
  const def = runtime.find((a) => a.default === true)
  return def ? [def, ...runtime.filter((a) => a !== def)] : runtime
}

/** Agent 菜单选项（默认 agent 带「默认」提示）。 */
export function agentMenuOptions<T extends AgentRow>(agents: T[]): AgentOption[] {
  return orderedRuntimeAgents(agents).map((agent) => ({
    id: agentKey(agent),
    label: agentLabel(agent) || agentKey(agent),
    ...(agent.default === true ? { hint: "默认" } : {}),
  }))
}

/** runtime 声明的默认主 agent（无标记 = 未知，不猜）。 */
export function defaultAgentKey<T extends AgentRow>(agents: T[]): string | null {
  const hit = (agents || []).find((a) => isRuntimeAgent(a) && a.default === true)
  return hit ? agentKey(hit) : null
}

/** runtime 声明的规划模式 agent（「先规划，再执行」入口）。 */
export function planningAgent<T extends AgentRow>(agents: T[]): T | null {
  return (agents || []).find((a) => isRuntimeAgent(a) && a.planning === true) ?? null
}

/** Tab 循环：默认 → 其余 → 默认；单 agent / 无 agent 返回 null（不抢键）。 */
export function nextRuntimeAgent<T extends AgentRow>(agents: T[], currentKey: string | null): T | null {
  const ordered = orderedRuntimeAgents(agents)
  if (ordered.length < 2) return null
  const index = currentKey ? ordered.findIndex((a) => isAgentKey(a, currentKey)) : -1
  return ordered[(index + 1) % ordered.length] ?? null
}

// MAFW 身份简称（runtime 原生 label 直接展示，不做名字特判）。
const AGENT_SHORT: Record<string, string> = {
  "manager": "lead",
  "mafw-create": "create",
}

/** 会话 pill 的 agent 偏差徽标：未选择 / 默认 agent 不占位；无默认标记时只在
 *  用户本次显式选择后展示（老 gateway 无法证明「偏差」，不猜）。 */
export function agentBadge(
  agentName: string | null | undefined,
  agents: AgentRow[],
  explicit = true,
): string | null {
  const name = (agentName ?? "").trim()
  if (!name) return null
  const key = name.toLowerCase()
  const defaultKey = defaultAgentKey(agents)
  if (defaultKey) {
    if (defaultKey.toLowerCase() === key) return null
  } else if (!explicit) {
    return null
  }
  const hit = (agents || []).find((a) => isAgentKey(a, name))
  return AGENT_SHORT[key] ?? (hit ? agentLabel(hit) || name : name)
}

/** 菜单 id → 列表里稳定键匹配的 entry（大小写不敏感）。 */
export function findAgentEntry<T extends AgentLike>(agents: T[], id: string): T | undefined {
  return agents.find((a) => isAgentKey(a, id))
}

/** 会话 pill 的 thinking 偏差徽标：未显式设定不占位。 */
export function thinkingBadge(level: ThinkingLevel | null | undefined): string | null {
  if (!level) return null
  return `⚡ ${level}`
}
