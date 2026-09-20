import {
  ApprovalPolicyService, ApprovalPolicyDeps, AUTO_APPROVE_BUDGET,
} from '../../../src/core/approval/policy-service';

function makeDeps(overrides: Partial<ApprovalPolicyDeps> = {}) {
  const calls: { mode: Array<[string, 'manual' | 'auto']>; broadcasts: Array<{ sid: string; mode: string; reason: string }> } = {
    mode: [], broadcasts: [],
  };
  const deps: ApprovalPolicyDeps = {
    getInternalRole: () => undefined,
    allowlistMatches: () => false,
    loadMode: async () => 'manual' as const,
    saveMode: async (sid, mode) => { calls.mode.push([sid, mode]); },
    onModeChanged: (sid, mode, reason) => { calls.broadcasts.push({ sid, mode, reason }); },
    ...overrides,
  };
  return { deps, calls };
}

const SAFE = { toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' } } };
const DANGEROUS = { toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -rf /' } } };

describe('评估顺序（spec §6.2，逐条短路）', () => {
  it('1. 内部会话 → auto-deny（即使 dangerous / 白名单命中）', () => {
    const { deps } = makeDeps({ getInternalRole: () => 'extract' });
    const svc = new ApprovalPolicyService(deps);
    const d = svc.evaluate('s1', SAFE);
    expect(d.action).toBe('auto-deny');
    expect(d.reason).toContain('role=extract');
    // dangerous 候选同样 deny
    expect(svc.evaluate('s1', DANGEROUS).action).toBe('auto-deny');
    // 白名单命中也 deny（内部会话优先级最高）
    const { deps: d2 } = makeDeps({ getInternalRole: () => 'btw', allowlistMatches: () => true });
    expect(new ApprovalPolicyService(d2).evaluate('s1', SAFE).action).toBe('auto-deny');
  });

  it('2. 持久白名单命中 → auto-approve（manual 模式也放行）', () => {
    const { deps } = makeDeps({ allowlistMatches: (tool) => tool === 'bash' });
    const svc = new ApprovalPolicyService(deps);
    expect(svc.evaluate('s1', SAFE).action).toBe('auto-approve');
  });

  it('3. manual（缺省）→ human', () => {
    const { deps } = makeDeps();
    const svc = new ApprovalPolicyService(deps);
    const d = svc.evaluate('s1', SAFE);
    expect(d.action).toBe('human');
    expect(d.verdict).toBe('safe');
  });

  it('4. auto 模式 + dangerous → human（高危永不自动放行）', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1'); // 触发懒加载
    const d = svc.evaluate('s1', DANGEROUS);
    expect(d.action).toBe('human');
    expect(d.verdict).toBe('dangerous');
  });

  it('5. 预算耗尽 → 回落 manual + 广播 + 清零', async () => {
    const { deps, calls } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    for (let i = 0; i < AUTO_APPROVE_BUDGET; i++) {
      expect(svc.evaluate('s1', SAFE).action).toBe('auto-approve');
    }
    expect(svc.getAutoApprovals('s1')).toBe(AUTO_APPROVE_BUDGET);
    const d = svc.evaluate('s1', SAFE); // 第 26 次
    expect(d.action).toBe('human');
    expect(d.reason).toContain('budget');
    expect(calls.broadcasts.some((b) => b.sid === 's1' && b.mode === 'read-only')).toBe(true);
    expect(calls.mode.some(([sid, m]) => sid === 's1' && m === 'read-only')).toBe(true);
    expect(svc.getAutoApprovals('s1')).toBe(0);
    // 回落后维持 read-only
    expect(svc.evaluate('s1', SAFE).action).toBe('human');
  });

  it('6. auto + safe → auto-approve 计数递增', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    const d = svc.evaluate('s1', SAFE);
    expect(d.action).toBe('auto-approve');
    expect(d.reason).toContain('1/25');
    expect(svc.getAutoApprovals('s1')).toBe(1);
  });
});

describe('mode 持久化与预算重置', () => {
  it('evaluate 在 mode 未加载完成时按 manual 保守处理', () => {
    let resolveLoad: (m: 'manual' | 'auto') => void = () => {};
    const { deps } = makeDeps({ loadMode: () => new Promise<'manual' | 'auto'>((r) => { resolveLoad = r; }) });
    const svc = new ApprovalPolicyService(deps);
    expect(svc.evaluate('s1', SAFE).action).toBe('human'); // 未加载 → manual
    resolveLoad('auto');
  });

  it('getMode 懒加载 kv 值', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    expect(await svc.getMode('s1')).toBe('auto');
  });

  it('setMode：内存 + kv + 广播 + 预算清零；legacy manual 归一化 read-only 并重置预算', async () => {
    const { deps, calls } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    svc.evaluate('s1', SAFE); // count=1
    await svc.setMode('s1', 'manual');
    expect(calls.mode).toContainEqual(['s1', 'read-only']);
    expect(calls.broadcasts.some((b) => b.mode === 'read-only' && b.reason === 'user toggled')).toBe(true);
    expect(svc.getAutoApprovals('s1')).toBe(0);
    await svc.setMode('s1', 'auto');
    expect(svc.evaluate('s1', SAFE).reason).toContain('1/25'); // 预算重新计
  });

  it('kv 写失败 fail-open：内存态仍生效', async () => {
    const { deps } = makeDeps({ saveMode: async () => { throw new Error('db down'); } });
    const svc = new ApprovalPolicyService(deps);
    await expect(svc.setMode('s1', 'auto')).resolves.toBeUndefined();
    expect(await svc.getMode('s1')).toBe('auto');
  });
});
