import { ToolRegistry, type ToolComponent, type ToolProps } from "@mafw/session-ui/message-part"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"
import { MafwSearchCard } from "./memory-read"
import { MafwAddMemoryCard } from "./memory-write"
import { MafwDeltasCard } from "./interact"
import { MafwRuleCard } from "./automation"
import { MafwPythonCard, MafwPythonRestartCard } from "./python"
import { MafwExecuteCard } from "./execute"
import { REGISTERED_TOOLS, RULE_TOOLS, aliasKeys } from "./registered-tools"

export { REGISTERED_TOOLS }

// opencode MCP 工具名 = "mafw_" + 裸名（gateway server key 前缀），
// ToolRegistry 精确匹配，故同一渲染器同时挂裸名（插件原生工具）与前缀别名。
// 别名规则单一来源：registered-tools.aliasKeys。
function registerAliased(name: string, render: ToolComponent) {
  for (const key of aliasKeys(name)) ToolRegistry.register({ name: key, render })
}

export function registerMafwToolCards() {
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    registerAliased(name, familyCard(spec))
  }
  ToolRegistry.register({ name: "execute", render: MafwExecuteCard })
  registerAliased("mafw_search_hybrid", MafwSearchCard)
  registerAliased("mafw_add_memory", MafwAddMemoryCard)
  registerAliased("mafw_get_deltas", MafwDeltasCard)
  for (const name of RULE_TOOLS) {
    registerAliased(name, (props: ToolProps) => MafwRuleCard({ ...props, tool: name }))
  }
  registerAliased("mafw_python", MafwPythonCard)
  registerAliased("mafw_python_restart", MafwPythonRestartCard)
}
