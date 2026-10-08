import { createBuiltinIdentityRegistry, toAgentDefinition, policyDecides } from '../../src/runtime/identity-registry';

const registry = createBuiltinIdentityRegistry();
// 类别映射（与 identity-registry.ts TOOL_CATEGORY_TABLES.opencode 一致的子集）
const CAT: Record<string, string> = {
  edit: 'file-edit', write: 'file-edit', apply_patch: 'file-edit',
  bash: 'shell', read: 'readonly', grep: 'readonly', glob: 'readonly',
};
const cat = (t: string) => CAT[t] ?? null;

describe('goal 节点身份', () => {
  it('注册表含三个节点身份，scope=worker，systemPrompt 非空', () => {
    for (const name of ['mafw-plan', 'mafw-execute', 'mafw-review']) {
      const spec = registry.get(name);
      expect(spec).toBeDefined();
      expect(spec!.scope).toBe('worker');
      expect(spec!.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('mafw-plan 拒绝 file-edit 与 shell，放行 readonly', () => {
    const policy = registry.get('mafw-plan')!.policy;
    expect(policyDecides(policy, 'edit', cat)).toBe('deny');
    expect(policyDecides(policy, 'bash', cat)).toBe('deny');
    expect(policyDecides(policy, 'read', cat)).toBe('allow');
  });

  it('mafw-review 拒绝 file-edit、放行 bash（跑测试）', () => {
    const policy = registry.get('mafw-review')!.policy;
    expect(policyDecides(policy, 'edit', cat)).toBe('deny');
    expect(policyDecides(policy, 'bash', cat)).toBe('allow');
  });

  it('mafw-execute 无 deny（全开）', () => {
    expect(registry.get('mafw-execute')!.policy.deny).toHaveLength(0);
  });

  it('toAgentDefinition：deny 类别派生原生权限', () => {
    const def = toAgentDefinition(registry.get('mafw-plan')!);
    expect(def.mode).toBe('subagent');
    expect((def.permissions as any).edit).toBe('deny');
    expect((def.permissions as any).bash).toBe('deny');
  });
});
