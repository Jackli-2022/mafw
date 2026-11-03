// gateway/tests/unit/goal/probe-scope-guard.test.ts
// Task 14：ProbeScopeGuard —— 探针只能做 ProbeRequest 声明的动作。
//
// 不变量：
// - 主工作区永远不写（绝对路径 / `..` 逃逸 / NUL 一律 deny，不是 ask）；
// - 声明范围内 allow（安全、隔离的 Spike 默认不打扰用户）；
// - 越界（未声明的路径 / 命令类别 / 网络 / 凭据）ask —— 转人工；
// - 内部 Session / full-access 身份不能把 ask 变成自动放行（guard 在政策环之前）。
import * as path from 'path';
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
  return { request: probe(overrides), workspaceDir: WORKSPACE, projectDir: MAIN_PROJECT };
}

describe('ProbeScopeGuard.evaluate', () => {
  it('allows read-only access to declared project sources but never project writes', () => {
    // 读工具：主项目内、声明路径内 → 允许（Spike 必须能读真实源码，否则只能对着空目录推理）。
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'read', path: `${MAIN_PROJECT}/src/a.ts` }))
      .toBe('allow');
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'grep', path: `${MAIN_PROJECT}/src/deep/b.ts` }))
      .toBe('allow');
    // 声明外的项目路径 → 转人工（不是「任意读」）。
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'read', path: `${MAIN_PROJECT}/.env` }))
      .toBe('ask');
    // 写工具：主项目内仍然结构上拒绝（人工也不批）。
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'edit', path: `${MAIN_PROJECT}/src/a.ts` }))
      .toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { tool: 'write', path: `${MAIN_PROJECT}/src/a.ts` }))
      .toBe('deny');
    // 看不到工具（无法证明是只读）→ 仍然 deny。
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

  it('denies shell commands that reach the main project or escape the workspace', () => {
    // 声明了 test/read 也不够：`cd <mainProject>` 是绕过路径参数的隔离突破。
    expect(ProbeScopeGuard.evaluate(binding(), { command: `cd ${MAIN_PROJECT}` })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { command: `bash -lc "cat ${MAIN_PROJECT}/src/a.ts"` }))
      .toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'cd .. && cat src/a.ts' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'cd src && npm test' })).toBe('allow');
    // Windows 大小写/反斜杠同一判定。
    expect(ProbeScopeGuard.evaluate(
      binding(),
      { command: `cd ${MAIN_PROJECT.replace(/\//g, '\\').toUpperCase()}` },
    )).toBe('deny');
    // 没有 projectDir 绑定（旧调用方）时仍按命令类别判定，不误伤普通命令。
    expect(ProbeScopeGuard.evaluate(probe(), { command: 'npm test' })).toBe('allow');
  });

  it('resolves cd targets instead of substring matching (parent dir + relative path)', () => {
    const parent = path.dirname(MAIN_PROJECT);
    const base = path.basename(MAIN_PROJECT);

    // `cd <projectParent> && cat <basename>/src/a.ts`：两者单独看都不含项目全路径。
    expect(ProbeScopeGuard.evaluate(binding(), {
      command: `cd ${parent} && cat ${base}/src/a.ts`,
    })).toBe('deny');
    // 选项形态：`cd -- ..` / `cd -P ..` / `cd ".."` 都解析到工作区之外。
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'cd -- ..' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'cd -P .. && npm test' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'cd ".."' })).toBe('deny');
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'pushd ../..' })).toBe('deny');
    // 相对路径参数也不许逃出工作区（即使没有 cd）。
    expect(ProbeScopeGuard.evaluate(binding(), { command: `cat ../${base}/src/a.ts` })).toBe('deny');
    // 允许：工作区内相对目录与工作区内绝对路径。
    expect(ProbeScopeGuard.evaluate(binding(), { command: 'cd src && npm test' })).toBe('allow');
    expect(ProbeScopeGuard.evaluate(binding(), { command: `cd ${WORKSPACE}/src && npm test` })).toBe('allow');
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

  it('auto-approves a read of declared project sources and denies project writes', async () => {
    const h = makePolicy({
      binding: binding(),
      mode: 'full-access',
      identity: { name: 'mafw-execute', internal: true },
      identityPolicy: expansivePolicy,
      internalRole: 'worker',
    });

    // Builder 读主项目里声明的源码：范围内 → 自动放行（不打扰用户）。
    const readDecision = h.policy.evaluate('probe_ses', {
      toolName: 'read', patterns: [], metadata: { filePath: `${MAIN_PROJECT}/src/a.ts` },
    });
    expect(readDecision.action).toBe('auto-approve');

    // 同一路径的写入仍然结构性拒绝。
    const props: Record<string, any> = {};
    applyApprovalPolicy(h.policy, h.runtime, {
      requestId: 'req-read-write', toolName: 'edit', patterns: [],
      metadata: { filePath: `${MAIN_PROJECT}/src/a.ts` },
    } as any, 'probe_ses', props);
    expect(props.mafwPolicy.action).toBe('auto-deny');
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

  it('identity deny wins over a probe ask (no human can approve around the identity)', () => {
    const h = makePolicy({
      binding: binding(),
      mode: 'full-access',
      identity: { name: 'mafw-execute', internal: true },
      identityPolicy: { deny: ['bash'], allowlist: [] },
      internalRole: 'worker',
    });
    const props: Record<string, any> = {};
    applyApprovalPolicy(h.policy, h.runtime, {
      requestId: 'req3', toolName: 'bash', patterns: ['npm install left-pad'], metadata: {},
    } as any, 'probe_ses', props);

    // 越界（install 未声明 → ask）也没用：身份 deny 先判，直接拒绝、不给人批的机会。
    expect(props.mafwPolicy.action).toBe('auto-deny');
    expect(props.probeScope).toMatchObject({ probeId: 'p1', verdict: 'ask' });
    expect(h.replies).toHaveLength(1);
    expect(h.replies[0][2]).toBe('reject');
  });

  it('auto-approves an in-scope action even for an internal probe session', () => {
    const h = makePolicy({ binding: binding(), mode: 'read-only', internalRole: 'worker' });
    const decision = h.policy.evaluate('probe_ses', {
      toolName: 'bash', patterns: ['npm test'], metadata: {},
    });
    expect(decision.action).toBe('auto-approve');
  });
});
