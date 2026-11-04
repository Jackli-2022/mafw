// 会话配置菜单的纯模型：pill 偏差徽标、档位列表、Agent 切换选项。
// 设计：一域一菜单（模型 + agent + thinking）；默认态只显示模型名，偏差才出徽标。
import type { ThinkingLevel } from "@mafw/sdk"

export const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]

/** Agent 行三项：默认/plan/build（对齐 Tab 三态循环；莱标用户可回默认）。 */
export const AGENT_SWITCH_OPTIONS: Array<{ id: "default" | "plan" | "build"; label: string }> = [
  { id: "default", label: "默认" },
  { id: "plan", label: "plan" },
  { id: "build", label: "build" },
]

const AGENT_SHORT: Record<string, string> = {
  "lead": "lead",
  "manager": "lead",
  "mafw-create": "create",
}

/** 会话 pill 的 agent 偏差徽标：默认 build（或无值）不占位。 */
export function agentBadge(agent: string | null | undefined): string | null {
  const name = (agent ?? "").trim()
  if (!name || name === "build") return null
  return AGENT_SHORT[name] ?? name
}

/** 会话 pill 的 thinking 偏差徽标：未显式设定不占位。 */
export function thinkingBadge(level: ThinkingLevel | null | undefined): string | null {
  if (!level) return null
  return `⚡ ${level}`
}
