import { describe, expect, test } from "bun:test"
import { REGISTERED_TOOLS, RULE_TOOLS } from "./registered-tools"
import { TOOL_SPECS } from "./extract"

const ALL_TOOLS = [
  // gateway MCP（39，gateway/src/mcp/tool-registry.ts）
  "mafw_create_goal", "mafw_update_state", "mafw_search_hybrid",
  "mafw_get_deltas", "mafw_load_state", "mafw_ask_user",
  "mafw_record_feedback", "mafw_get_model_route", "mafw_add_memory",
  "mafw_supersede_memory", "mafw_pin_memory", "mafw_get_memory",
  "mafw_commit_heuristic", "mafw_get_axioms", "mafw_merge_memory",
  "mafw_resolve_merge", "mafw_set_goal", "mafw_get_goal_status",
  "mafw_list_goals", "mafw_answer_question", "mafw_get_evidence",
  "mafw_cancel_goal", "mafw_list_pending_questions",
  "mafw_list_automation_rules", "mafw_get_automation_rule",
  "mafw_list_triage_items", "mafw_get_triage_item",
  "mafw_get_automation_history", "mafw_run_automation",
  "mafw_validate_rule", "mafw_propose_triage_decision",
  "mafw_draft_automation_rule",
  "mafw_desktop_screenshot", "mafw_desktop_navigate",
  "mafw_desktop_get_ui_state", "mafw_desktop_click", "mafw_desktop_type",
  "mafw_desktop_scroll", "mafw_restart_agent",
  // 插件侧（5，src/plugin.ts）
  "mafw_media_ask", "mafw_media_upload", "mafw_media_speak",
  "mafw_python", "mafw_python_restart",
]

describe("registration completeness", () => {
  test("REGISTERED_TOOLS 覆盖全部 44 个第一方工具", () => {
    expect([...REGISTERED_TOOLS].sort()).toEqual([...ALL_TOOLS].sort())
  })
  test("无重复注册 key", () => {
    expect(new Set(REGISTERED_TOOLS).size).toBe(REGISTERED_TOOLS.length)
  })
  test("spec / bespoke / rule 三区数字吻合（30 + 5 + 9）", () => {
    expect(Object.keys(TOOL_SPECS)).toHaveLength(30)
    expect(RULE_TOOLS).toHaveLength(9)
  })
})
