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
