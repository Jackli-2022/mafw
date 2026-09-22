import { ToolRegistry, type ToolProps } from "@mafw/session-ui/message-part"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"
import { MafwSearchCard } from "./memory-read"
import { MafwAddMemoryCard } from "./memory-write"
import { MafwDeltasCard } from "./interact"
import { MafwRuleCard, RULE_TOOLS } from "./automation"
import { MafwPythonCard, MafwPythonRestartCard } from "./python"

export const REGISTERED_TOOLS = [
  // TOOL_SPECS（30）
  "mafw_supersede_memory", "mafw_pin_memory", "mafw_merge_memory",
  "mafw_resolve_merge", "mafw_commit_heuristic",
  "mafw_get_memory", "mafw_get_axioms",
  "mafw_create_goal", "mafw_set_goal", "mafw_get_goal_status",
  "mafw_list_goals", "mafw_cancel_goal", "mafw_get_evidence",
  "mafw_update_state", "mafw_load_state", "mafw_answer_question",
  "mafw_list_pending_questions",
  "mafw_ask_user", "mafw_record_feedback", "mafw_get_model_route",
  "mafw_desktop_screenshot", "mafw_desktop_navigate",
  "mafw_desktop_get_ui_state", "mafw_desktop_click", "mafw_desktop_type",
  "mafw_desktop_scroll", "mafw_restart_agent",
  "mafw_media_upload", "mafw_media_ask", "mafw_media_speak",
  // bespoke（5）
  "mafw_search_hybrid", "mafw_add_memory", "mafw_get_deltas",
  "mafw_python", "mafw_python_restart",
  // rule 族（9）
  ...RULE_TOOLS,
] as const

export function registerMafwToolCards() {
  for (const [name, spec] of Object.entries(TOOL_SPECS)) {
    ToolRegistry.register({ name, render: familyCard(spec) })
  }
  ToolRegistry.register({ name: "mafw_search_hybrid", render: MafwSearchCard })
  ToolRegistry.register({ name: "mafw_add_memory", render: MafwAddMemoryCard })
  ToolRegistry.register({ name: "mafw_get_deltas", render: MafwDeltasCard })
  for (const name of RULE_TOOLS) {
    ToolRegistry.register({
      name,
      render: (props: ToolProps) => MafwRuleCard({ ...props, tool: name }),
    })
  }
  ToolRegistry.register({ name: "mafw_python", render: MafwPythonCard })
  ToolRegistry.register({ name: "mafw_python_restart", render: MafwPythonRestartCard })
}
