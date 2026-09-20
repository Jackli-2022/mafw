// 三档预设（spec 切片 1）：read-only / auto / full-access；'manual' 为 legacy 别名
// 归一化 read-only。评估顺序不变（internal deny > rules > mode 分支）。
import {
  ApprovalPolicyService, ApprovalPolicyDeps, AUTO_APPROVE_BUDGET,
} from '../../../src/core/approval/policy-service';

function makeDeps(overrides: Partial<ApprovalPolicyDeps> = {}) {
  const calls: { mode: Array<[string, string]>; broadcasts: Array<{ sid: string; mode: string; reason: string }> } = {
    mode: [], broadcasts: [],
  };
  const deps: ApprovalPolicyDeps = {
    getInternalRole: () => undefined,
    allowlistMatches: () => false,
    loadMode: async () => 'read-only' as any,
    saveMode: async (sid, mode) => { calls.mode.push([sid, mode as any]); },
    onModeChanged: (sid, mode, reason) => { calls.broadcasts.push({ sid, mode, reason }); },
    ...overrides,
  };
  return { deps, calls };
}

const READ = { toolName: 'read', patterns: [] };
const SAFE_WRITE = { toolName: 'bash', patterns: [], metadata: { args: { command: 'npm test' } } };
const DANGEROUS = { toolName: 'bash', patterns: [], metadata: { args: { command: 'rm -rf /' } } };

describe('read-only 档', () => {
  it('只读工具 → auto-approve；变更类 → human', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'read-only' as any });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    expect(svc.evaluate('s1', READ).action).toBe('auto-approve');
    const d = svc.evaluate('s1', SAFE_WRITE);
    expect(d.action).toBe('human');
    expect(d.reason).toContain('read-only');
  });
});

describe('full-access 档', () => {
  it('dangerous 也 auto-approve，且不消耗预算', async () => {
    const { deps } = makeDeps({ loadMode: async () => 'full-access' as any });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    expect(svc.evaluate('s1', DANGEROUS).action).toBe('auto-approve');
    expect(svc.evaluate('s1', SAFE_WRITE).action).toBe('auto-approve');
    expect(svc.getAutoApprovals('s1')).toBe(0);
  });
});

describe('auto 档预算回落', () => {
  it('预算耗尽 → 回落 read-only（原 manual）+ 广播 + kv 写 read-only', async () => {
    const { deps, calls } = makeDeps({ loadMode: async () => 'auto' });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    for (let i = 0; i < AUTO_APPROVE_BUDGET; i++) svc.evaluate('s1', SAFE_WRITE);
    const d = svc.evaluate('s1', SAFE_WRITE);
    expect(d.action).toBe('human');
    expect(d.reason).toContain('budget');
    expect(calls.broadcasts.some((b) => b.sid === 's1' && b.mode === 'read-only')).toBe(true);
    expect(calls.mode.some(([sid, m]) => sid === 's1' && m === 'read-only')).toBe(true);
    expect(await svc.getMode('s1')).toBe('read-only');
  });
});

describe('legacy manual 别名', () => {
  it("kv 存量 'manual' 读归一化为 read-only", async () => {
    const { deps } = makeDeps({ loadMode: async () => 'manual' as any });
    const svc = new ApprovalPolicyService(deps);
    expect(await svc.getMode('s1')).toBe('read-only');
  });
  it("setMode('manual') 写归一化为 read-only", async () => {
    const { deps, calls } = makeDeps({});
    const svc = new ApprovalPolicyService(deps);
    await svc.setMode('s1', 'manual' as any);
    expect(await svc.getMode('s1')).toBe('read-only');
    expect(calls.mode.some(([, m]) => m === 'read-only')).toBe(true);
  });
});

describe('internal fail-closed 钉扎（spec 切片 1 fail 语义）', () => {
  it('内部会话在任何档位下都 auto-deny（full-access 也不例外）', async () => {
    const { deps } = makeDeps({
      getInternalRole: () => 'manager',
      loadMode: async () => 'full-access' as any,
    });
    const svc = new ApprovalPolicyService(deps);
    await svc.getMode('s1');
    expect(svc.evaluate('s1', READ).action).toBe('auto-deny');
  });
});
