export const RULE_TOOLS = [
  "mafw_list_automation_rules", "mafw_get_automation_rule",
  "mafw_list_triage_items", "mafw_get_triage_item",
  "mafw_get_automation_history", "mafw_run_automation",
  "mafw_validate_rule", "mafw_propose_triage_decision",
  "mafw_draft_automation_rule",
] as const

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

// opencode 对 MCP 工具的命名是 sanitize(serverKey) + "_" + toolName，
// 经 gateway MCP 暴露的工具 part.tool 实为 "mafw_" + 裸名（如 mafw_mafw_search_hybrid）。
// ToolRegistry 只按精确 key 匹配，故每个工具需同时挂裸名（插件原生）与前缀别名（MCP），
// 这是别名规则的唯一来源——registerMafwToolCards 与测试都走它。
export function aliasKeys(name: string): string[] {
  return [name, `mafw_${name}`]
}

export function registryKeys(): string[] {
  return REGISTERED_TOOLS.flatMap(aliasKeys)
}
