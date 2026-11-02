import { TOOL_NAME_ALIASES } from "@mafw/session-ui/parts-rules"

const MAFW_PREFIX = "mafw_"

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

// ---------------------------------------------------------------------------
// Declarative plugin tool-card slot keys (Task 10)
// ---------------------------------------------------------------------------

/**
 * Every ToolRegistry key a plugin-declared logical tool name may answer to.
 *
 * Packages declare logical tool names, not wire aliases (spec §8.3): the bare
 * name, the opencode MCP double prefix (`mafw_mafw_*`), the un-prefixed form of
 * an `mafw_*` declaration, and the canonical runtime name from session-ui's
 * `TOOL_NAME_ALIASES` (e.g. `shell` → `bash`, `subagent` → `task`) are all
 * accepted. Canonical aliases come from the shared renderer rules module — no
 * second alias table lives here.
 */
export function toolCardKeys(name: string): string[] {
  const keys = new Set<string>()
  const add = (value: string) => {
    if (value) keys.add(value)
  }
  for (const key of aliasKeys(name)) add(key)
  if (name.startsWith(MAFW_PREFIX)) add(name.slice(MAFW_PREFIX.length))
  const canonical = TOOL_NAME_ALIASES[name]
  if (canonical) for (const key of aliasKeys(canonical)) add(key)
  for (const [alias, target] of Object.entries(TOOL_NAME_ALIASES)) {
    if (target !== name) continue
    for (const key of aliasKeys(alias)) add(key)
  }
  return [...keys]
}

/**
 * Tools whose cards are claimed by unified declarative tool cards.
 *
 * Legacy `~/.mafw/ui-plugins` cards re-list asynchronously (IPC) and would
 * otherwise overwrite a unified proxy registered for the same tool; they check
 * this set before registering. Claims mirror the currently registered unified
 * proxies and are replaced atomically on every plugin revision.
 */
const unifiedToolCardClaims = new Set<string>()

export function setUnifiedToolCardClaims(targets: Iterable<string>): void {
  unifiedToolCardClaims.clear()
  for (const target of targets) unifiedToolCardClaims.add(target)
}

export function isUnifiedToolCardClaimed(target: string): boolean {
  return unifiedToolCardClaims.has(target)
}
