// gateway/tests/unit/goal/full-chain-approval.test.ts
// Task 15：条件式整链批准（full_chain）。
//
// 语义：
//   plan(need_probe + waves + goalEval + continuation) → 用户批准整包 → probe → 
//   全部结论解析为 continue → 直接 execute（没有第二次计划门）；
//   任何 reapprove / 未覆盖结论 / 计划内容改动 → 批准作废（pending）+ 回 planning。
//
// 不变量：
// - 批准绑定**整包**（waves + goalEval + approvalMode + continuation），任一改动都会失效；
// - full_chain 只在 manual 审阅模式下生效（没有人工门就没有整链批准）；
// - 规则解析 fail-closed：没有命中规则 = 未预期结果 = reapprove，绝不默认放行；
// - 作废后的 pending 记录不可再批（只有驻留批准门 AWAIT_PLAN_APPROVAL 才可批准）。
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal, Harness } from '../helpers/goal-driver-harness';
import type { GoalProbePort, GoalProbeWorkspace } from '../../../src/core/goal/driver';
import type { ProbeConclusion, ProbeReport, ProbeRequest } from '../../../src/core/goal/probe';
import { validateProbeReport } from '../../../src/core/goal/probe';
import { goalEvalArtifactPath, nodeArtifactPaths } from '../../../src/core/goal/node-prompts';
import {
  computePlanPackageHash,
  evaluateProbeContinuation,
  probeContinuationRules,
  validateContinuationRules,
  validatePlanPackage,
  type ProbeContinuationRules,
} from '../../../src/core/goal/plan-package';

// ── 计划产物 ────────────────────────────────────────────────────────────────

const ALL_RULES: ProbeContinuationRules = {
  default: { supports: 'continue', refutes: 'reapprove', inconclusive: 'reapprove' },
};

function goalEval(): any {
  return {
    outcome: '探针结论能收敛计划假设',
    conditions: [
      {
        id: 'g1', statement: '最终计划引用了探针证据', required: true,
        evidence: 'waves.json + probe 报告', method: '读取产物',
      },
    ],
    mapping: { g1: { tasks: ['w1-t1'] } },
  };
}

function waves(title = '按探针结论实施'): any[] {
  return [{
    id: 'w1',
    title: '实施',
    riskNote: '探针结论可能只覆盖主路径',
    tasks: [{ taskId: 'w1-t1', title, acceptance: ['npm test 全绿'] }],
  }];
}

/** planPackage(...)：整包最小形态（waves + goalEval），测试按需叠加 full_chain 字段。 */
function planPackage(over: Record<string, unknown> = {}): any {
  return { waves: waves(), goalEval: goalEval(), ...over };
}

function probeDraft(over: Record<string, unknown> = {}): any {
  return {
    question: '现有 store 能否在不改契约的前提下扩展？',
    hypothesis: '可以，新增可选字段即可',
    scope: { paths: ['src'], commandClasses: ['read', 'test'], network: false, credentials: [] },
    budget: { maxMinutes: 10, maxUsd: 1 },
    evidenceRequired: ['npm test 输出'],
    affects: { planAssertions: ['store 扩展不破坏契约'] },
    ...over,
  };
}

function fullChainDoc(over: Record<string, unknown> = {}): any {
  return {
    status: 'need_probe',
    approvalMode: 'full_chain',
    waves: waves(),
    goalEval: goalEval(),
    probes: [probeDraft()],
    continuation: ALL_RULES,
    ...over,
  };
}

function hashOf(doc: any): string {
  return computePlanPackageHash(doc);
}

// ── fake probe port（与 Task 14 测试同语义，测试内最小实现） ──────────────────

interface FakeProbePort extends GoalProbePort {
  requests: ProbeRequest[];
  reports: Map<string, ProbeReport>;
  created: GoalProbeWorkspace[];
  completeReport(id: string, report?: Omit<ProbeReport, 'probeId'>): ProbeReport;
}

const supportsReport: Omit<ProbeReport, 'probeId'> = {
  conclusion: 'supports',
  commands: ['npm test -- store'],
  keyOutput: 'tests passed: 12',
  repro: ['npm test -- store'],
  remainingAssumptions: ['只在 node 22 上验证'],
  impact: { plan: '可以新增可选字段', goalEval: 'g1 证据加上探针报告' },
};

function makeProbePort(h: Harness): FakeProbePort {
  const requests: ProbeRequest[] = [];
  const reports = new Map<string, ProbeReport>();
  const created: GoalProbeWorkspace[] = [];
  let seq = 0;

  const complete = (id: string, input: unknown): ProbeReport => {
    const report = validateProbeReport({ ...(input as any), probeId: id });
    reports.set(id, report);
    return report;
  };

  return {
    requests,
    reports,
    created,
    podIdForGoal: () => 'pod1',
    enqueue: ({ podId, goalId, revision, drafts }) => drafts.map((draft) => {
      seq += 1;
      const id = `p${seq}`;
      requests.push({
        id, podId, goalId, revision,
        question: draft.question,
        hypothesis: draft.hypothesis,
        scope: draft.scope,
        budget: draft.budget,
        evidenceRequired: draft.evidenceRequired,
        affects: draft.affects ?? {},
      });
      return id;
    }),
    take: ({ probeIds }) => {
      const id = probeIds.find((candidate) => !reports.has(candidate));
      return requests.find((r) => r.id === id) ?? null;
    },
    report: (id) => reports.get(id) ?? null,
    complete,
    reportPath: (goalId, probeId) =>
      path.join(h.mafwDir, 'goals', goalId, 'probes', `${probeId}.report.json`),
    prepareWorkspace: async ({ goalId, probeId }) => {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), `mafw-probe-${goalId}-${probeId}-`));
      const ws: GoalProbeWorkspace = {
        dir,
        dispose: async () => { fs.rmSync(dir, { recursive: true, force: true }); },
      };
      created.push(ws);
      return ws;
    },
    disposeWorkspace: async (ws) => { await ws.dispose(); },
    failProbe: (id) => { reports.delete(id); },
    requeueProbe: (id) => { reports.delete(id); },
    bindSession: () => { /* no-op */ },
    completeReport: (id, report = supportsReport) => complete(id, report),
  };
}

function writePlan(h: Harness, goalId: string, doc: any, opts: { revision?: number } = {}): string {
  const a = nodeArtifactPaths(h.mafwDir, goalId, 1, { revision: opts.revision ?? 1 });
  fs.mkdirSync(path.dirname(a.waves), { recursive: true });
  fs.writeFileSync(a.waves, JSON.stringify(doc), 'utf-8');
  return a.waves;
}

function sessionOf(h: Harness) {
  return h.load('g1')?.nodeSession ?? null;
}

function lastPrompt(h: Harness): any {
  return h.calls.filter((c: any) => c.op === 'promptAsync').at(-1);
}

/** manual planReview + full_chain 计划：推进到"待批"（探针尚未执行）。 */
async function parkFullChain(
  h: Harness,
  opts: { doc?: any; port?: FakeProbePort; revision?: number } = {},
): Promise<{ wavesPath: string; doc: any }> {
  const doc = opts.doc ?? fullChainDoc();
  seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
  if (opts.port) h.deps.probes = opts.port;
  await h.driver.advance('g1');
  const wavesPath = writePlan(h, 'g1', doc, { revision: opts.revision ?? 1 });
  await h.fireIdle(sessionOf(h)!.id);
  return { wavesPath, doc };
}

// ── 纯逻辑：规则与整包哈希 ──────────────────────────────────────────────────

describe('plan package carries the full-chain contract', () => {
  test('normalizes approvalMode and continuation rules', () => {
    const pkg = validatePlanPackage(planPackage({
      approvalMode: 'full_chain',
      continuation: {
        p1: { supports: ' continue ', refutes: 'reapprove' },
        default: { supports: 'continue', refutes: 'reapprove', inconclusive: 'reapprove' },
      },
    }));
    expect(pkg.approvalMode).toBe('full_chain');
    expect(pkg.continuation).toEqual({
      p1: { supports: 'continue', refutes: 'reapprove' },
      default: { supports: 'continue', refutes: 'reapprove', inconclusive: 'reapprove' },
    });
  });

  test('legacy packages stay two_stage (no mode, no rules)', () => {
    const pkg = validatePlanPackage(planPackage());
    expect(pkg.approvalMode).toBeUndefined();
    expect(pkg.continuation).toBeUndefined();
    expect(validateContinuationRules(undefined)).toBeUndefined();
  });

  test('rejects unknown modes, conclusions and decisions', () => {
    expect(() => validatePlanPackage(planPackage({ approvalMode: 'auto_pilot' })))
      .toThrow('approvalMode must be two_stage|full_chain');
    expect(() => validatePlanPackage(planPackage({
      approvalMode: 'full_chain',
      continuation: { default: { maybe: 'continue' } },
    }))).toThrow('unknown conclusion');
    expect(() => validatePlanPackage(planPackage({
      approvalMode: 'full_chain',
      continuation: { default: { supports: 'skip' } },
    }))).toThrow('must be continue|reapprove');
    expect(() => validateContinuationRules([])).toThrow('continuation must be an object');
  });

  test('the package hash changes when the continuation rules change', () => {
    const base = computePlanPackageHash(planPackage({ approvalMode: 'full_chain', continuation: ALL_RULES }));
    const relaxed = computePlanPackageHash(planPackage({
      approvalMode: 'full_chain',
      continuation: { default: { supports: 'reapprove', refutes: 'reapprove', inconclusive: 'reapprove' } },
    }));
    expect(relaxed).not.toBe(base);
    // 同一 waves/eval 下 two_stage 的哈希不受 full_chain 字段影响（存量批准零迁移）。
    expect(computePlanPackageHash(planPackage()))
      .toBe(computePlanPackageHash(planPackage({ approvalMode: 'two_stage' })));
  });
});

describe('probeContinuationRules', () => {
  test('matches the exact probe id first, then the default rule', () => {
    const rules: ProbeContinuationRules = {
      p2: { refutes: 'continue' },
      default: { supports: 'continue', refutes: 'reapprove', inconclusive: 'reapprove' },
    };
    expect(probeContinuationRules(rules, 'p2', 'refutes')).toBe('continue');
    expect(probeContinuationRules(rules, 'p1', 'supports')).toBe('continue');
    expect(probeContinuationRules(rules, 'p1', 'inconclusive')).toBe('reapprove');
  });

  test('returns null when nothing covers the result (never defaults to continue)', () => {
    expect(probeContinuationRules(undefined, 'p1', 'supports')).toBeNull();
    expect(probeContinuationRules({ p1: { supports: 'continue' } }, 'p1', 'refutes')).toBeNull();
    expect(probeContinuationRules({ p1: { supports: 'continue' } }, 'p9', 'supports')).toBeNull();
  });
});

describe('evaluateProbeContinuation', () => {
  const results = (list: Array<[string, ProbeConclusion]>) =>
    list.map(([probeId, conclusion]) => ({ probeId, conclusion }));

  test('continues only when every result resolves to continue', () => {
    expect(evaluateProbeContinuation({ rules: ALL_RULES, results: results([['p1', 'supports']]) }))
      .toEqual({ status: 'continue' });
    expect(evaluateProbeContinuation({ rules: ALL_RULES, results: results([['p9', 'supports']]) }))
      .toEqual({ status: 'continue' }); // default 规则覆盖未知 id
  });

  test('reapproves on an explicit reapprove or an unexpected conclusion', () => {
    const refuted = evaluateProbeContinuation({ rules: ALL_RULES, results: results([['p1', 'refutes']]) });
    expect(refuted.status).toBe('reapprove');
    expect(refuted).toMatchObject({ probeId: 'p1', decision: 'reapprove' });

    const unexpected = evaluateProbeContinuation({
      rules: { p1: { supports: 'continue' } },
      results: results([['p1', 'inconclusive']]),
    });
    expect(unexpected).toMatchObject({ status: 'reapprove', probeId: 'p1', decision: null });
    expect((unexpected as any).reason).toContain('no continuation rule');
  });

  test('reapproves when the approved package hash no longer matches', () => {
    const verdict = evaluateProbeContinuation({
      rules: ALL_RULES,
      results: results([['p1', 'supports']]),
      packageHash: 'hash-a',
      currentPackageHash: 'hash-b',
    });
    expect(verdict).toMatchObject({ status: 'reapprove' });
    expect((verdict as any).reason).toContain('changed');
  });
});

// ── driver：整链批准 ────────────────────────────────────────────────────────

describe('full-chain approval parks before the probes run', () => {
  test('needs a manual review gate, a valid package and continuation rules', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    const { wavesPath, doc } = await parkFullChain(h, { port });

    const st = h.load('g1')!;
    expect(st.nextAction).toBe('AWAIT_PLAN_APPROVAL');
    expect(st.nextNode).toBe('execute');
    expect(st.planApproval).toMatchObject({
      status: 'pending',
      approvalMode: 'full_chain',
      round: 1,
      revision: 1,
      planHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      packageHash: hashOf(JSON.parse(fs.readFileSync(wavesPath, 'utf-8'))),
    });
    expect(st.planApproval!.packageHash).toBe(hashOf(doc));
    // 探针已入队但一行代码都没跑（没有 Builder 会话、没有工作区）。
    expect(st.probeQueue).toEqual(['p1']);
    expect(st.probeRefs).toEqual([]);
    expect(port.created).toHaveLength(0);
    expect(h.calls.filter((c: any) => c.op === 'create')).toHaveLength(1);
    expect(st.wavePlanPath).toBe(wavesPath);
    // 实施计划的另一条腿（goalEval）已落盘，批准后 execute→review 直接可用。
    expect(fs.existsSync(goalEvalArtifactPath(h.mafwDir, 'g1', 1))).toBe(true);
    // 计划模型被明确告知可以一次性整链批准。
    expect(lastPrompt(h).parts[0].text).toContain('full_chain');
    expect(lastPrompt(h).parts[0].text).toContain('continuation');
  });

  test('fails closed without waves/goalEval or without continuation rules', async () => {
    const missingEval = makeHarness();
    seedGoal(missingEval, 'g1', { patch: { planReview: 'manual' } });
    missingEval.deps.probes = makeProbePort(missingEval);
    await missingEval.driver.advance('g1');
    writePlan(missingEval, 'g1', fullChainDoc({ goalEval: undefined, waves: undefined }));
    await missingEval.fireIdle(sessionOf(missingEval)!.id);
    expect(missingEval.nodeRuns[0].status).toBe('failed');
    expect(missingEval.load('g1')!.planApproval).toBeUndefined();
    expect(missingEval.load('g1')!.probeQueue ?? []).toEqual([]);

    const noRules = makeHarness();
    seedGoal(noRules, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(noRules);
    noRules.deps.probes = port;
    await noRules.driver.advance('g1');
    writePlan(noRules, 'g1', fullChainDoc({ continuation: undefined }));
    await noRules.fireIdle(sessionOf(noRules)!.id);
    expect(noRules.nodeRuns[0].status).toBe('failed');
    expect(noRules.nodeRuns[0].error).toContain('continuation');
    expect(port.requests).toHaveLength(0);
  });

  test('two_stage stays the default: probes run without any plan approval', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    h.deps.probes = port;
    await h.driver.advance('g1');
    writePlan(h, 'g1', fullChainDoc({ approvalMode: undefined, continuation: undefined }));
    await h.fireIdle(sessionOf(h)!.id);

    const st = h.load('g1')!;
    expect(st.planApproval).toBeUndefined();
    expect(st.nextNode).toBe('probe');
    expect(port.created).toHaveLength(1);
  });

  test('auto review mode cannot park a full chain (no human gate)', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    seedGoal(h, 'g1');
    h.deps.probes = port;
    await h.driver.advance('g1');
    writePlan(h, 'g1', fullChainDoc());
    await h.fireIdle(sessionOf(h)!.id);

    const st = h.load('g1')!;
    expect(st.planApproval).toBeUndefined();
    expect(st.nextNode).toBe('probe');
    expect(port.created).toHaveLength(1);
  });
});

describe('approved full chain', () => {
  test('probes run only after approval, and all-continue goes straight to implementation', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    await parkFullChain(h, { port });
    const approvalId = h.load('g1')!.planApproval!.id;
    const planHash = h.load('g1')!.planApproval!.planHash!;

    await expect(h.driver.approvePlan('g1', approvalId, { planHash })).resolves.toBe(true);
    let st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('approved');
    // 批准后才 claim 探针（快照批准 ≠ 立即放行实施）。
    expect(st.nodeSession?.phase).toBe('probe');
    expect(port.created).toHaveLength(1);

    port.completeReport('p1');
    await h.driver.advance('g1');

    st = h.load('g1')!;
    expect(st.probeRefs).toEqual(['p1']);
    expect(st.probeQueue).toEqual([]);
    expect(st.nextNode).toBe('execute');
    expect(st.nodeSession?.phase).toBe('execute');
    expect(st.planApproval).toMatchObject({ status: 'approved' });
    expect((st.planApproval as any).probeDecisions).toMatchObject({ p1: { decision: 'continue' } });
    // 没有第二次计划门：整条链只跑了一次 plan。
    expect(h.nodeRuns.filter((r: any) => r.node === 'plan')).toHaveLength(1);
  });

  test('a refuted probe invalidates the approval and returns to planning with feedback', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    await parkFullChain(h, { port });
    await h.driver.approvePlan('g1', h.load('g1')!.planApproval!.id);

    port.completeReport('p1', { ...supportsReport, conclusion: 'refutes' });
    await h.driver.advance('g1');

    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.nextNode).toBe('plan');
    // 回规划 = 真的重新开了 plan 节点（不是停在批准门）。
    expect(st.nodeSession?.phase).toBe('plan');
    expect(st.planFeedback).toContain('重新批准');
    expect((st.planApproval as any).invalidated?.reason).toContain('re-approval');

    // 回 planning 后，旧 pending 记录不可再批（只有驻留批准门才可批准）。
    expect(await h.driver.approvePlan('g1', h.load('g1')!.planApproval!.id)).toBe(false);

    // 下一版计划看到探针证据 + 失效原因。
    const prompt = lastPrompt(h).parts[0].text as string;
    expect(lastPrompt(h).agent).toBe('mafw-plan');
    expect(prompt).toContain('tests passed: 12');
    expect(prompt).toContain('重新批准');
  });

  test('an uncovered conclusion is an unexpected result (reapprove)', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    await parkFullChain(h, {
      port,
      doc: fullChainDoc({ continuation: { p1: { supports: 'continue' } } }),
    });
    await h.driver.approvePlan('g1', h.load('g1')!.planApproval!.id);

    port.completeReport('p1', { ...supportsReport, conclusion: 'inconclusive' });
    await h.driver.advance('g1');

    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.nextNode).toBe('plan');
    expect((st.planApproval as any).invalidated?.reason).toContain('no continuation rule');
  });

  test('a plan rewritten after approval invalidates the chain even when the probe continues', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    const { wavesPath } = await parkFullChain(h, { port });
    await h.driver.approvePlan('g1', h.load('g1')!.planApproval!.id);

    // 批准后计划被改写（范围变化）：即使探针结论是 continue 也不得直接实施。
    const rewritten = fullChainDoc({ waves: waves('范围扩大：顺带重构 store') });
    fs.writeFileSync(wavesPath, JSON.stringify(rewritten), 'utf-8');
    port.completeReport('p1');
    await h.driver.advance('g1');

    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.nextNode).toBe('plan');
    expect((st.planApproval as any).invalidated?.reason).toContain('changed');
  });

  test('a batch continues only when every probe continues', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    await parkFullChain(h, {
      port,
      doc: fullChainDoc({ probes: [probeDraft(), probeDraft({ question: '第二个问题' })] }),
    });
    await h.driver.approvePlan('g1', h.load('g1')!.planApproval!.id);

    port.completeReport('p1');
    await h.driver.advance('g1');
    let st = h.load('g1')!;
    expect(st.probeQueue).toEqual(['p2']);
    expect(st.planApproval?.status).toBe('approved');
    expect(st.nextNode).toBe('probe');
    expect(st.nodeSession?.phase).toBe('probe');

    port.completeReport('p2', { ...supportsReport, conclusion: 'refutes' });
    await h.driver.advance('g1');
    st = h.load('g1')!;
    expect(st.probeRefs).toEqual(['p1', 'p2']);
    expect(st.probeQueue).toEqual([]);
    expect(st.planApproval?.status).toBe('pending');
    expect(st.nextNode).toBe('plan');
  });

  test('an earlier reapprove is not washed out by a later continue', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    await parkFullChain(h, {
      port,
      doc: fullChainDoc({ probes: [probeDraft(), probeDraft({ question: '第二个问题' })] }),
    });
    await h.driver.approvePlan('g1', h.load('g1')!.planApproval!.id);

    port.completeReport('p1', { ...supportsReport, conclusion: 'refutes' });
    await h.driver.advance('g1');
    let st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.nextNode).toBe('probe'); // 另一条探针仍在队列里，继续跑完

    port.completeReport('p2'); // continue
    await h.driver.advance('g1');
    st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.nextNode).toBe('plan');
    expect((st.planApproval as any).invalidated?.probeId).toBe('p1');
  });

  test('a stale plan hash is still refused before approval', async () => {
    const h = makeHarness();
    const port = makeProbePort(h);
    await parkFullChain(h, { port });
    const approvalId = h.load('g1')!.planApproval!.id;

    await expect(h.driver.approvePlan('g1', approvalId, { planHash: 'stale' }))
      .rejects.toMatchObject({ code: 'stale_plan' });
    expect(h.load('g1')!.planApproval?.status).toBe('pending');
    expect(port.created).toHaveLength(0);

    await expect(h.driver.approvePlan('g1', approvalId)).resolves.toBe(true);
    expect(h.load('g1')!.planApproval?.status).toBe('approved');
  });
});
