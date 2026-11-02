// gateway/tests/unit/goal/probe-scope-guard.test.ts
// Task 14：ProbeScopeGuard —— 探针只能做 ProbeRequest 声明的动作。
//
// 不变量：
// - 主工作区永远不写（绝对路径 / `..` 逃逸 / NUL 一律 deny，不是 ask）；
// - 声明范围内 allow（安全、隔离的 Spike 默认不打扰用户）；
// - 越界（未声明的路径 / 命令类别 / 网络 / 凭据）ask —— 转人工；
// - 内部 Session / full-access 身份不能把 ask 变成自动放行（guard 在政策环之前）。
import { ApprovalPolicyService } from '../../../src/core/approval/policy-service';
import { applyApprovalPolicy } from '../../../src/core/approval/hook';
import {
  ProbeScopeGuard,
  probeActionFromApproval,
} from '../../../src/core/goal/probe-scope-guard';
import type { ProbeRequest } from '../../../src/core/goal/probe';

function probe(overrides: Partial<ProbeRequest> = {}): ProbeRequest {
  return {
    id: 'p1',
    podId: 'pod1',
    goalId: 'g1',
    revision: 1,
    question: '现有 store 能否在不改契约的前提下扩展？',
    hypothesis: '可以，只需新增可选字段',
    scope: {
      paths: ['src'],
      commandClasses: ['read', 'test'],
      network: false,
      credentials: [],
    },
    budget: { maxMinutes: 20, maxUsd: 2 },
    evidenceRequired: ['npm test 输出'],
    affects: { planAssertions: ['a1'] },
    ...overrides,
  };
}

const WORKSPACE = process.platform === 'win32' ? 'C:\\tmp\\mafw-probes\\p1' : '/tmp/mafw-probes/p1';
const MAIN_PROJECT = process.platform === 'win32' ? 'C:\\repo\\project' : '/repo/project';

function binding(overrides: Partial<ProbeRequest> = {}) {
  return { request: probe(overrides), workspaceDir: WORKSPACE };
}

describe('ProbeScopeGuard.evaluate', () => {
  it('denies absolute paths into the main workspace (never a write path)', () => {
    expect(ProbeScopeGuard.evaluate(binding(), { path: `${MAIN_PROJECT}/src/a.ts` })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { path: `${MAIN_PROJECT}/src/a.ts`, workspaceDir: WORKSPACE }))
      .toBe('deny');
  });

  it('allows in-scope relative paths and asks for undeclared ones', () => {
    expect(ProbeScopeGuard.evaluate(binding(), { path: 'src/a.ts' })).toBe('allow');
    expect(ProbeScopeGuard.evaluate(binding(), { path: './src/deep/b.ts' })).toBe('allow');
    expect(ProbeScopeGuard.evaluate(binding(), { path: 'docs/plan.md' })).toBe('ask');
  });

  it('allows every path when the scope declares the whole workspace', () => {
    expect(ProbeScopeGuard.evaluate(binding({ scope: { ...probe().scope, paths: ['.'] } }), { path: 'any/where.txt' }))
      .toBe('allow');
  });

  it('denies path escapes and NUL bytes', () => {
    expect(ProbeScopeGuard.evaluate(binding(), { path: '../outside.txt' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { path: 'src/../../etc/passwd' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { path: 'src/a\0.ts' })).toBe('deny');
  });

  it('asks for network when the request did not declare it', () => {
    expect(ProbeScopeGuard.evaluate(binding(), { network: true })).toBe('ask');
    expect(ProbeScopeGuard.evaluate(binding({ scope: { ...probe().scope, network: true } }), { network: true }))
      .toBe('allow');
  });

  it('scopes credentials and command classes', () => {
    expect(ProbeScopeGuard.evaluate(binding(), { credential: 'PROD_DB' })).toBe('ask');
    expect(
      ProbeScopeGuard.evaluate(
        binding({ scope: { ...probe().scope, credentials: ['CI_TOKEN'] } }),
        { credential: 'CI_TOKEN' },
      ),
    ).toBe('allow');
    expect(ProbeScopeGuard.evaluate(binding(), { commandClass: 'test' })).toBe('allow');
    expect(ProbeScopeGuard.evaluate(binding(), { commandClass: 'install' })).toBe('ask');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'npm install left-pad' })).toBe('ask');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'npm test -- store' })).toBe('allow');
  });

  it('fails closed without a bound probe request', () => {
    expect(ProbeScopeGuard.evaluate(null, { path: 'src/a.ts' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(undefined, { network: true })).toBe('deny');
  });

  it('asks when a mutating/shell action has no visible target', () => {
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'write' })).toBe('ask');
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'bash' })).toBe('ask');
  });

  it('derives actions from approval facets', () => {
    expect(probeActionFromApproval('bash', ['npm install left-pad'])).toMatchObject({
      command: 'npm install left-pad',
      commandClass: 'install',
      network: true,
    });
    expect(probeActionFromApproval('read', [], { filePath: 'src/a.ts' })).toMatchObject({ path: 'src/a.ts' });
    expect(probeActionFromApproval('webfetch', ['https://example.com'])).toMatchObject({ network: true });
  });
});

// ── 审批政策集成：guard 必须先于身份 / internal / full-access ──

interface PolicyHarness {
  policy: ApprovalPolicyService;
  replies: any[];
  runtime: any;
}

function makePolicy(opts: {
  binding?: { request: ProbeRequest; workspaceDir?: string | null } | null;
  mode?: 'read-only' | 'auto' | 'full-access';
  identity?: { name: string; internal: boolean };
  identityPolicy?: any;
  internalRole?: string;
}): PolicyHarness {
  const replies: any[] = [];
  const policy = new ApprovalPolicyService({
    getInternalRole: () => opts.internalRole,
    allowlistMatches: () => false,
    loadMode: async () => opts.mode ?? 'read-only',
    saveMode: async () => {},
    onModeChanged: () => {},
    getIdentity: () => opts.identity,
    getPolicy: () => opts.identityPolicy,
    getProbeScope: () => opts.binding ?? undefined,
  });
  const runtime: any = {
    session: {
      permissionReply: async (...args: any[]) => { replies.push(args); },
    },
  };
  return { policy, replies, runtime };
}

const expansivePolicy = { deny: [], allowlist: ['*'] };

describe('probe scope is enforced before identity and internal auto-approval', () => {
  it('auto-approves in-scope actions even in read-only mode', async () => {
    const h = makePolicy({ binding: binding(), mode: 'read-only' });
    const decision = h.policy.evaluate('probe_ses', { toolName: 'read', patterns: [], metadata: { filePath: 'src/a.ts' } });
    expect(decision.action).toBe('auto-approve');
  });

  it('asks a human for out-of-scope actions even with internal identity allow + full-access', async () => {
    const h = makePolicy({
      binding: binding(),
      mode: 'full-access',
      identity: { name: 'mafw-execute', internal: true },
      identityPolicy: expansivePolicy,
      internalRole: 'worker',
    });
    const decision = h.policy.evaluate('probe_ses', {
      toolName: 'write',
      patterns: [],
      metadata: { filePath: 'docs/plan.md' },
    });
    expect(decision.action).toBe('human');

    // hook 是生产入口：ask 必须变成 human，且不得自动答复。
    const props: Record<string, any> = {};
    applyApprovalPolicy(h.policy, h.runtime, {
      requestId: 'req1', toolName: 'write', patterns: [], metadata: { filePath: 'docs/plan.md' },
    } as any, 'probe_ses', props);
    expect(props.mafwPolicy.action).toBe('human');
    expect(props.probeScope).toMatchObject({ probeId: 'p1', verdict: 'ask' });
    expect(h.replies).toHaveLength(0);
  });

  it('denies main-workspace paths regardless of identity (auto reply reject)', async () => {
    const h = makePolicy({
      binding: binding(),
      mode: 'full-access',
      identity: { name: 'mafw-execute', internal: true },
      identityPolicy: expansivePolicy,
    });
    const props: Record<string, any> = {};
    applyApprovalPolicy(h.policy, h.runtime, {
      requestId: 'req2', toolName: 'edit', patterns: [], metadata: { filePath: `${MAIN_PROJECT}/src/a.ts` },
    } as any, 'probe_ses', props);
    expect(props.mafwPolicy.action).toBe('auto-deny');
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0][2]).toBe('reject');
  });

  it('leaves non-probe sessions on the normal policy path', async () => {
    const h = makePolicy({ binding: null, mode: 'full-access' });
    await h.policy.getMode('normal_ses'); // 完成 kv 懒加载（首评按 read-only 保守）
    const decision = h.policy.evaluate('normal_ses', { toolName: 'write', patterns: [], metadata: {} });
    expect(decision.action).toBe('auto-approve');
  });

  it('identity deny still wins over an in-scope action', () => {
    const h = makePolicy({
      binding: binding(),
      mode: 'full-access',
      identity: { name: 'mafw-execute', internal: true },
      identityPolicy: { deny: ['bash'], allowlist: [] },
      internalRole: 'worker',
    });
    const decision = h.policy.evaluate('probe_ses', {
      toolName: 'bash', patterns: ['npm test'], metadata: {},
    });
    expect(decision.action).toBe('auto-deny');
  });

  it('auto-approves an in-scope action even for an internal probe session', () => {
    const h = makePolicy({ binding: binding(), mode: 'read-only', internalRole: 'worker' });
    const decision = h.policy.evaluate('probe_ses', {
      toolName: 'bash', patterns: ['npm test'], metadata: {},
    });
    expect(decision.action).toBe('auto-approve');
  });
});
