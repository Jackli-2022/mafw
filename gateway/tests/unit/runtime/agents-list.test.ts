// GET /api/agents 的身份可见性契约（spec 2026-11-02-pod-collaborative-goal-loop §3.1）：
// 用户可选择的协调身份只有 Lead；`manager` 是 deprecated 别名，仍可物化给既有会话读取，
// 但绝不能作为第二个可选身份出现在 agent 列表里。
import * as fs from 'fs';
import * as path from 'path';
import { createBuiltinIdentityRegistry } from '../../../src/runtime/identity-registry';
import { mergeAgentLists } from '../../../src/runtime/identity-state';

const registry = createBuiltinIdentityRegistry();

/** 与 index.ts `GET /api/agents` 的注册表分支同形（materialized 视为全部成功）。 */
function agentList(runtimeAgents: any[] = [{ name: 'build', description: 'runtime build agent' }]): any[] {
  return mergeAgentLists(
    registry.list().map((spec) => ({
      name: spec.name,
      description: spec.description,
      scope: spec.scope,
      deprecated: spec.deprecated,
      materialized: true,
    })),
    runtimeAgents,
  );
}

describe('GET /api/agents identity list', () => {
  it('exposes Lead as the only user-selectable project coordinator', () => {
    const names = agentList().map((a: any) => a.name);
    expect(names).toContain('lead');
    expect(names).not.toContain('manager');
    const lead = agentList().find((a: any) => a.name === 'lead');
    expect(lead).toMatchObject({ source: 'mafw', mode: 'primary' });
  });

  it('keeps the deprecated manager spec resolvable for legacy sessions', () => {
    expect(registry.get('manager')?.deprecated).toBe(true);
    expect(registry.get('manager')?.policy).toEqual(registry.get('lead')?.policy);
  });

  it('does not leak manager through the runtime agent branch (it stays materialized)', () => {
    const names = agentList([
      { name: 'manager', description: 'legacy materialized agent' },
      { name: 'build', description: 'runtime build agent' },
    ]).map((a: any) => a.name);
    expect(names).not.toContain('manager');
    expect(names).toContain('build');
  });

  it('lead is still listed together with the worker identities', () => {
    const names = agentList().map((a: any) => a.name);
    for (const name of ['lead', 'mafw-tech-lead', 'memory-curator', 'mafw-plan', 'mafw-execute', 'mafw-review']) {
      expect(names).toContain(name);
    }
  });
});

describe('/api/agents wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf-8');

  it('forwards the registry deprecated flag into the merge input', () => {
    expect(source).toMatch(/identityRegistry\.list\(\)\.map\(\(s\) => \(\{[\s\S]{0,300}deprecated: s\.deprecated/);
  });
});
