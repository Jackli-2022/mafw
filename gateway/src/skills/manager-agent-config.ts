import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from './manager-identity';
import { log } from '../core/utils/logger';

// The `manager` primary agent definition, installed into the global opencode
// config on gateway start so every registered project can switch to / mention
// the MAFW manager agent. Permission profile aligns with the built-in `plan`
// agent (no direct edits, no opencode task dispatch) plus an explicit allowlist
// for the gateway MCP tools (mafw_*), which the manager orchestrates through.
const MAFW_TOOL_ALLOWLIST = [
  'mafw_create_goal', 'mafw_update_state', 'mafw_search_hybrid', 'mafw_get_deltas',
  'mafw_load_state', 'mafw_ask_user', 'mafw_record_feedback', 'mafw_get_model_route',
  'mafw_add_memory', 'mafw_commit_heuristic', 'mafw_get_axioms', 'mafw_merge_memory',
  'mafw_resolve_merge', 'mafw_set_goal', 'mafw_get_goal_status', 'mafw_list_goals',
  'mafw_answer_question', 'mafw_get_evidence', 'mafw_cancel_goal', 'mafw_list_pending_questions',
  'mafw_list_automation_rules', 'mafw_get_automation_rule', 'mafw_list_triage_items',
  'mafw_get_triage_item', 'mafw_get_automation_history', 'mafw_run_automation',
  'mafw_validate_rule', 'mafw_propose_triage_decision', 'mafw_draft_automation_rule',
  'mafw_desktop_screenshot', 'mafw_desktop_navigate', 'mafw_desktop_get_ui_state',
  'mafw_desktop_click', 'mafw_desktop_type', 'mafw_desktop_scroll',
] as const;

function permissionYaml(): string {
  const tools = MAFW_TOOL_ALLOWLIST.map((t) => `  ${t}: allow`).join('\n');
  return `permission:
  question: allow
  plan_exit: allow
  task:
    general: deny
  edit:
    "*": deny
${tools}`;
}

const MANAGER_AGENT_TEMPLATE = `---
mode: primary
description: 编排 · 分解任务与调度
color: "#46DC82"
${permissionYaml()}
---

${MANAGER_IDENTITY_SYSTEM_PROMPT}
`;

/**
 * TODO(runtime-debt): this writes directly to opencode's agent config directory
 * (~/.config/opencode/agent/manager.md) using opencode's frontmatter permission
 * syntax. When supporting other runtimes, abstract behind a "agent definition
 * provider" interface. Other runtimes have different permission models.
 */
export function ensureManagerAgentConfig(): string | null {
  try {
    const dir = path.join(os.homedir(), '.config', 'opencode', 'agent');
    const file = path.join(dir, 'manager.md');
    // Always (re)write the template so permission changes propagate to
    // existing installs; the file is generated content, not user-owned.
    fs.mkdirSync(dir, { recursive: true });
    const existed = fs.existsSync(file);
    fs.writeFileSync(file, MANAGER_AGENT_TEMPLATE, 'utf-8');
    log.info(`[ManagerAgent] ${existed ? 'updated' : 'wrote'} ${file}`);
    return file;
  } catch (err: any) {
    log.error(`[ManagerAgent] failed to write config: ${err.message}`);
    return null;
  }
}
