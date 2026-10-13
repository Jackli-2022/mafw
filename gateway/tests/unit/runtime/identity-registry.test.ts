import {
  createBuiltinIdentityRegistry, toAgentDefinition, resolveToolCategory, policyDecides,
} from '../../../src/runtime/identity-registry';
import { getManagerAgentDefinition } from '../../../src/skills/manager-agent-config';
import { buildMemoryCuratorDefinition } from '../../../src/skills/memory-curator-agent';

const registry = createBuiltinIdentityRegistry();
const manager = registry.get('manager')!;
const curator = registry.get('memory-curator')!;

describe('builtin identities', () => {
  it('has manager (primary), memory-curator + goal nodes (worker)', () => {
    expect(registry.list().map((i) => i.name).sort()).toEqual([
      'mafw-execute', 'mafw-plan', 'mafw-review', 'manager', 'memory-curator',
    ]);
    expect(manager.scope).toBe('primary');
    expect(curator.scope).toBe('worker');
    expect(manager.systemPrompt).toContain('MAFW MANAGER IDENTITY');
  });

  it('manager policy denies file-edit/subagent, allowlists mafw_*/shell/readonly', () => {
    expect([...manager.policy.deny].sort()).toEqual(['file-edit', 'subagent']);
    for (const e of ['mafw_*', 'question', 'plan_exit', 'shell', 'readonly']) {
      expect(manager.policy.allowlist).toContain(e);
    }
  });

  it('memory-curator policy aligns with MEMORY_CURATOR_TOOLS', () => {
    expect([...curator.policy.deny].sort()).toEqual(['file-edit', 'shell', 'web']);
    for (const e of ['mafw_add_memory', 'mafw_search_hybrid', 'mafw_supersede_memory', 'readonly']) {
      expect(curator.policy.allowlist).toContain(e);
    }
  });
});

describe('toAgentDefinition (materialization derivation parity)', () => {
  it('manager derivation is byte-equivalent to the legacy builder', () => {
    expect(toAgentDefinition(manager)).toEqual(getManagerAgentDefinition());
  });

  it('memory-curator derivation is byte-equivalent to the legacy builder', () => {
    expect(toAgentDefinition(curator)).toEqual(buildMemoryCuratorDefinition());
  });

  it('derives color + native permissions + top-level tools for curator', () => {
    const def = toAgentDefinition(curator);
    expect(def.mode).toBe('subagent');
    expect(def.permissions).toEqual({ edit: 'deny', bash: 'deny' });
    expect(def.tools).toEqual(expect.objectContaining({ '*': false, mafw_add_memory: true, read: true }));
  });

  it('deny categories map to native permission keys when no native escape hatch', () => {
    const spec = { ...manager, policy: { deny: ['shell', 'web'], allowlist: undefined }, nativePermissions: undefined, nativeTools: undefined };
    const def = toAgentDefinition(spec);
    expect(def.permissions.bash).toBe('deny');
    expect(def.permissions.edit).toBeUndefined();
    expect(def.tools).toBeUndefined();
  });
});

describe('resolveToolCategory', () => {
  it('opencode names', () => {
    expect(resolveToolCategory('edit', 'opencode')).toBe('file-edit');
    expect(resolveToolCategory('apply_patch', 'opencode')).toBe('file-edit');
    expect(resolveToolCategory('bash', 'opencode')).toBe('shell');
    expect(resolveToolCategory('task', 'opencode')).toBe('subagent');
    expect(resolveToolCategory('webfetch', 'opencode')).toBe('web');
    expect(resolveToolCategory('read', 'opencode')).toBe('readonly');
    expect(resolveToolCategory('glob', 'opencode')).toBe('readonly');
    expect(resolveToolCategory('list', 'opencode')).toBe('readonly');
    expect(resolveToolCategory('mafw_set_goal', 'opencode')).toBeNull();
  });

  it('pi names（含此前漏登的 find——bug 修复：manager 身份不再误 auto-deny）', () => {
    expect(resolveToolCategory('bash', 'pi')).toBe('shell');
    expect(resolveToolCategory('grep', 'pi')).toBe('readonly');
    expect(resolveToolCategory('find', 'pi')).toBe('readonly');
    expect(resolveToolCategory('ls', 'pi')).toBe('readonly');
  });

  it('并集单表（v2026-10-13）：未知 runtime / Claude PascalCase / codex 条目类型均可解析', () => {
    // 旧 per-runtime 双表对未知 runtime 整表 miss（allowlist 语义反转为 deny）——
    // 并集表消除该缺陷；runtimeName 参数保留兼容
    expect(resolveToolCategory('bash', 'claude')).toBe('shell');
    expect(resolveToolCategory('Read', 'claude')).toBe('readonly');
    expect(resolveToolCategory('Glob', 'claude')).toBe('readonly');
    expect(resolveToolCategory('Agent', 'claude')).toBe('subagent');
    expect(resolveToolCategory('command_execution', 'codex')).toBe('shell');
    expect(resolveToolCategory('file_change', 'codex')).toBe('file-edit');
    expect(resolveToolCategory('web_search', 'codex')).toBe('web');
    // plan/other 落穿（由裸名/前缀规则裁决）
    expect(resolveToolCategory('todowrite', 'opencode')).toBeNull();
    expect(resolveToolCategory('some_mcp_tool', 'pi')).toBeNull();
  });
});

describe('policyDecides', () => {
  const cat = (t: string) => resolveToolCategory(t, 'opencode');
  it('deny wins over allowlist', () => {
    expect(policyDecides(manager.policy, 'edit', cat)).toBe('deny');
    expect(policyDecides(manager.policy, 'task', cat)).toBe('deny');
  });
  it('allowlist prefix wildcard + category entries', () => {
    expect(policyDecides(manager.policy, 'mafw_set_goal', cat)).toBe('allow');
    expect(policyDecides(manager.policy, 'bash', cat)).toBe('allow');
    expect(policyDecides(manager.policy, 'read', cat)).toBe('allow');
    expect(policyDecides(manager.policy, 'question', cat)).toBe('allow');
  });
  it('unlisted tool denied when allowlist present', () => {
    expect(policyDecides(manager.policy, 'webfetch', cat)).toBe('deny');
    expect(policyDecides(curator.policy, 'bash', cat)).toBe('deny');
  });
  it('null fallthrough when no allowlist and no deny match', () => {
    expect(policyDecides({ deny: ['file-edit'] }, 'bash', cat)).toBeNull();
  });
});
