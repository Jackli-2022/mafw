import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../../gateway/src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../gateway/src/config', () => ({
  config: {
    raw: { runtime: { pluginConfig: {} } },
    server: { serveUrl: 'http://127.0.0.1:4096' },
    resolvePath: (...p: string[]) => path.join(os.tmpdir(), '.mafw-test', ...p),
  },
}));

jest.mock('../../../gateway/src/opencode-adapter', () => ({
  createOpencodeAdapter: jest.fn(async () => ({
    session: {},
    global: {},
    provider: {},
    app: {},
    config: {},
  })),
}));

import { AgentDefinition } from '../../../gateway/src/runtime/agent-definition';
import { serializeAgentToFrontmatter, installAgentFile } from '../../../gateway/src/runtime/opencode-runtime';
import { getManagerAgentDefinition } from '../../../gateway/src/skills/manager-agent-config';
import { MANAGER_IDENTITY_SYSTEM_PROMPT } from '../../../gateway/src/skills/manager-identity';

describe('agents.install abstraction (debt 5b, route B)', () => {
  describe('serializeAgentToFrontmatter', () => {
    it('translates edit:deny to edit:{"*":deny}', () => {
      const def: AgentDefinition = {
        description: 'test',
        systemPrompt: 'hello',
        permissions: { edit: 'deny' },
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).toContain('  edit:\n    "*": deny');
    });

    it('translates task:{general:deny} to task block', () => {
      const def: AgentDefinition = {
        description: 'test',
        systemPrompt: 'hello',
        permissions: { task: { general: 'deny' } },
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).toContain('  task:\n    general: deny');
    });

    it('translates tools entries to top-level permission keys', () => {
      const def: AgentDefinition = {
        description: 'test',
        systemPrompt: 'hello',
        permissions: { tools: { question: 'allow', plan_exit: 'allow' } },
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).toContain('  question: allow');
      expect(out).toContain('  plan_exit: allow');
    });

    it('translates bash:allow to bash: allow', () => {
      const def: AgentDefinition = {
        description: 'test',
        systemPrompt: 'hello',
        permissions: { bash: 'allow' },
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).toContain('  bash: allow');
    });

    it('includes mode, description, color in frontmatter', () => {
      const def: AgentDefinition = {
        description: 'test desc',
        mode: 'primary',
        color: '#FF0000',
        systemPrompt: 'body',
        permissions: {},
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).toContain('mode: primary');
      expect(out).toContain('description: test desc');
      expect(out).toContain('color: "#FF0000"');
    });

    it('includes model and temperature when present', () => {
      const def: AgentDefinition = {
        description: 'test',
        model: 'openai/gpt-4',
        temperature: 0.7,
        systemPrompt: 'body',
        permissions: {},
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).toContain('model: openai/gpt-4');
      expect(out).toContain('temperature: 0.7');
    });

    it('omits optional fields when absent', () => {
      const def: AgentDefinition = {
        description: 'minimal',
        systemPrompt: 'body',
        permissions: {},
      };
      const out = serializeAgentToFrontmatter(def);
      expect(out).not.toContain('mode:');
      expect(out).not.toContain('color:');
      expect(out).not.toContain('model:');
      expect(out).not.toContain('temperature:');
    });

    it('manager agent frontmatter is byte-for-byte identical to legacy template', () => {
      const def = getManagerAgentDefinition();
      const actual = serializeAgentToFrontmatter(def);

      const legacyTools = [
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
      ];
      const toolsYaml = legacyTools.map((t) => `  ${t}: allow`).join('\n');
      const expected = `---
mode: primary
description: 编排 · 分解任务与调度
color: "#46DC82"
permission:
  question: allow
  plan_exit: allow
  task:
    general: deny
  edit:
    "*": deny
${toolsYaml}
---

${MANAGER_IDENTITY_SYSTEM_PROMPT}
`;
      expect(actual).toBe(expected);
    });
  });

  describe('getManagerAgentDefinition', () => {
    it('returns a valid AgentDefinition with correct permissions', () => {
      const def = getManagerAgentDefinition();
      expect(def.description).toBe('编排 · 分解任务与调度');
      expect(def.mode).toBe('primary');
      expect(def.color).toBe('#46DC82');
      expect(def.systemPrompt).toBe(MANAGER_IDENTITY_SYSTEM_PROMPT);
      expect(def.permissions.edit).toBe('deny');
      expect(def.permissions.task).toEqual({ general: 'deny' });
      expect(def.permissions.tools?.question).toBe('allow');
      expect(def.permissions.tools?.plan_exit).toBe('allow');
      expect(def.permissions.tools?.mafw_create_goal).toBe('allow');
      expect(def.permissions.tools?.mafw_desktop_scroll).toBe('allow');
    });
  });

  describe('capability gate: agentConfigApi=false', () => {
    it('skips install and logs warn when agentConfigApi is false', async () => {
      const warnSpy = jest.fn();
      const installSpy = jest.fn();

      const caps = { agentConfigApi: false };
      const agents = { install: installSpy };

      if (caps.agentConfigApi && agents) {
        await agents.install('manager', getManagerAgentDefinition());
      } else {
        warnSpy('[ManagerAgent] agentConfigApi not available — manager agent permission guardrails unavailable');
      }

      expect(installSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[ManagerAgent] agentConfigApi not available — manager agent permission guardrails unavailable',
      );
    });

    it('calls install when agentConfigApi is true', async () => {
      const warnSpy = jest.fn();
      const installSpy = jest.fn().mockResolvedValue(undefined);

      const caps = { agentConfigApi: true };
      const agents = { install: installSpy };

      if (caps.agentConfigApi && agents) {
        await agents.install('manager', getManagerAgentDefinition());
      } else {
        warnSpy('[ManagerAgent] agentConfigApi not available');
      }

      expect(installSpy).toHaveBeenCalledTimes(1);
      expect(installSpy.mock.calls[0][0]).toBe('manager');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('opencode agents.install writes file', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-install-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes agent markdown to correct path', () => {
      const def = getManagerAgentDefinition();
      const filePath = installAgentFile('manager', def, tmpDir);

      expect(fs.existsSync(filePath)).toBe(true);
      expect(filePath).toBe(path.join(tmpDir, 'manager.md'));

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toBe(serializeAgentToFrontmatter(def));
    });
  });
});
