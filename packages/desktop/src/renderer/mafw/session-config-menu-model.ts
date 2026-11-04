// 会话配置菜单的纯模型：pill 偏差徽标、档位列表、Agent 切换选项。
// 设计：一域一菜单（模型 + agent + thinking）；默认态只显示模型名，偏差才出徽标。
import type { ThinkingLevel } from "@mafw/sdk"
import { isAgentKey, type AgentLike } from "./agent-identity"

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Thinking 子菜单项：默认（null = 清除存储档位）在前，其后七档。 */
export const THINKING_MENU_OPTIONS: Array<{ id: ThinkingLevel | null; label: string }> = [
  { id: null, label: "默认" },
  ...THINKING_LEVELS.map((level) => ({ id: level, label: level })),
]

/** Agent 行三项：默认/plan/build（对齐 Tab 三态循环；鼠标用户可回默认）。 */
export const AGENT_SWITCH_OPTIONS: Array<{ id: "default" | "plan" | "build"; label: string }> = [
  { id: "default", label: "默认" },
  { id: "plan", label: "plan" },
  { id: "build", label: "build" },
]

const AGENT_SHORT: Record<string, string> = {
  "plan": "plan",
  "lead": "lead",
  "manager": "lead",
  "mafw-create": "create",
}

/** 会话 pill 的 agent 偏差徽标：默认 build（或无值）不占位。大小写不敏感
 *  （view DTO 的 id 是 Build/Plan，历史 picks 可能存小写）。 */
export function agentBadge(agent: string | null | undefined): string | null {
  const name = (agent ?? "").trim()
  if (!name) return null
  const key = name.toLowerCase()
  if (key === "build") return null
  return AGENT_SHORT[key] ?? name
}

/** 菜单小写 id（build/plan）→ 列表里稳定键匹配的 entry（大小写不敏感）。 */
export function findAgentEntry<T extends AgentLike>(agents: T[], id: string): T | undefined {
  return agents.find((a) => isAgentKey(a, id))
}

/** 会话 pill 的 thinking 偏差徽标：未显式设定不占位。 */
export function thinkingBadge(level: ThinkingLevel | null | undefined): string | null {
  if (!level) return null
  return `⚡ ${level}`
}
