import { AgentDefinition } from '../runtime/agent-definition';
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from './manager-identity';

const MAFW_TOOL_ALLOWLIST = [
  'mafw_create_goal', 'mafw_update_state', 'mafw_search_hybrid', 'mafw_get_deltas',
  'mafw_load_state', 'mafw_ask_user', 'mafw_record_feedback', 'mafw_get_model_route',
  'mafw_add_memory', 'mafw_supersede_memory', 'mafw_pin_memory', 'mafw_commit_heuristic', 'mafw_get_axioms', 'mafw_merge_memory',
  'mafw_resolve_merge', 'mafw_set_goal', 'mafw_get_goal_status', 'mafw_list_goals',
  'mafw_answer_question', 'mafw_get_evidence', 'mafw_cancel_goal', 'mafw_list_pending_questions',
  'mafw_list_automation_rules', 'mafw_get_automation_rule', 'mafw_list_triage_items',
  'mafw_get_triage_item', 'mafw_get_automation_history', 'mafw_run_automation',
  'mafw_validate_rule', 'mafw_propose_triage_decision', 'mafw_draft_automation_rule',
  'mafw_desktop_screenshot', 'mafw_desktop_navigate', 'mafw_desktop_get_ui_state',
  'mafw_desktop_click', 'mafw_desktop_type', 'mafw_desktop_scroll',
  'mafw_restart_agent',
] as const;

export function getManagerAgentDefinition(): AgentDefinition {
  const tools: Record<string, 'allow'> = {
    question: 'allow',
    plan_exit: 'allow',
  };
  for (const t of MAFW_TOOL_ALLOWLIST) {
    tools[t] = 'allow';
  }
  return {
    description: '编排 · 分解任务与调度',
    mode: 'primary',
    color: '#46DC82',
    systemPrompt: MANAGER_IDENTITY_SYSTEM_PROMPT,
    permissions: {
      edit: 'deny',
      task: { general: 'deny' },
      tools,
    },
  };
}
