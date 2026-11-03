import { describe, expect, it } from '@jest/globals';
import {
  getPluginCreatorAgentDefinition,
  PLUGIN_CREATOR_SYSTEM_PROMPT,
} from '../../../src/skills/plugin-creator-identity';
import {
  createBuiltinIdentityRegistry,
  policyDecides,
  resolveToolCategory,
  toAgentDefinition,
} from '../../../src/runtime/identity-registry';

const catOf = (t: string) => resolveToolCategory(t, 'opencode');

describe('plugin creator agent definition', () => {
  const def = getPluginCreatorAgentDefinition();

  it('is a primary agent with an ask-gated edit surface and no shell', () => {
    expect(def.mode).toBe('primary');
    expect(def.permissions.bash).toBe('deny');
    expect(def.permissions.edit).toBe('ask');
    expect(def.permissions.tools?.mafw_plugin_manager).toBe('ask');
  });

  it("uses tools['*']=false but keeps the shipped skill and both plugin tools visible", () => {
    expect(def.tools?.['*']).toBe(false);
    expect(def.tools?.skill).toBe(true);
    expect(def.tools?.mafw_plugin_inspect).toBe(true);
    expect(def.tools?.mafw_plugin_manager).toBe(true);
    expect(def.tools?.bash).not.toBe(true);
    expect(def.tools?.webfetch).not.toBe(true);
    expect(def.tools?.task).not.toBe(true);
  });

  it('keeps the identity prompt thin and points at the skill for detail', () => {
    expect(def.systemPrompt).toContain('plugin-creator');
    expect(def.systemPrompt).toContain('.mafw/plugin-drafts/<packageName>');
    expect(def.systemPrompt).toContain('mafw_plugin_manager');
    expect(def.systemPrompt).toContain('applyPending');
    expect(def.systemPrompt).not.toContain('maxWidgets');
    expect(def.systemPrompt).not.toContain('PLUGIN_UI_LIMITS');
    expect(def.systemPrompt.length).toBeLessThan(1_500);
    expect(def.systemPrompt).toBe(PLUGIN_CREATOR_SYSTEM_PROMPT);
  });

  it('does not repeat the tutorial content owned by skills/plugin-creator/SKILL.md', () => {
    // Detail markers that must live only in the skill, never in the identity.
    for (const marker of ['configPages', 'toolCards', 'messageWindows', 'inputSchema', 'node --test']) {
      expect(def.systemPrompt).not.toContain(marker);
    }
  });
});

describe('mafw-create identity registration', () => {
  const registry = createBuiltinIdentityRegistry();
  const creator = registry.get('mafw-create')!;

  it('is registered as a primary identity without a pinned model', () => {
    expect(creator).toBeDefined();
    expect(creator.scope).toBe('primary');
    expect(creator.model).toBeUndefined();
    expect(creator.deprecated).toBeUndefined();
  });

  it('allows the skill + plugin tools and denies shell/web/subagent', () => {
    expect(creator.policy.allowlist).toEqual(expect.arrayContaining([
      'skill', 'mafw_plugin_inspect', 'mafw_plugin_manager',
    ]));
    expect(creator.policy.deny).toEqual(expect.arrayContaining(['shell', 'web', 'subagent']));
    expect(creator.policy.deny).not.toContain('file-edit');

    expect(policyDecides(creator.policy, 'skill', catOf)).toBe('allow');
    expect(policyDecides(creator.policy, 'mafw_plugin_inspect', catOf)).toBe('allow');
    expect(policyDecides(creator.policy, 'mafw_plugin_manager', catOf)).toBe('allow');
    expect(policyDecides(creator.policy, 'edit', catOf)).toBe('allow');
    expect(policyDecides(creator.policy, 'read', catOf)).toBe('allow');
    expect(policyDecides(creator.policy, 'todowrite', catOf)).toBe('allow');
    expect(policyDecides(creator.policy, 'bash', catOf)).toBe('deny');
    expect(policyDecides(creator.policy, 'webfetch', catOf)).toBe('deny');
    expect(policyDecides(creator.policy, 'task', catOf)).toBe('deny');
    expect(policyDecides(creator.policy, 'mafw_set_goal', catOf)).toBe('deny');
  });

  it('derives the materialized definition byte-shape compatibly', () => {
    expect(toAgentDefinition(creator)).toEqual(getPluginCreatorAgentDefinition());
  });
});
