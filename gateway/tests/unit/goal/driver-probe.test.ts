// gateway/tests/unit/goal/driver-probe.test.ts
// Task 14：两段式 Spike（默认模式 A）。
//
// 两段式语义：
//   plan(need_probe) → probe(Builder, 隔离工作区) → ProbeReport → plan(ready) → 用户批准 → execute
//
// 不变量：
// - need_probe 不产生计划批准（批准只属于最终 ready 的 PlanPackage）；
// - 探针在隔离工作区里跑（会话 cwd ≠ 主项目），报告落盘后工作区立即销毁；
// - 报告进入计划上下文（下一版 plan prompt 必须看到证据与剩余假设）；
// - 探针数量有上限（防 Spike 无限挤占实施）。
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal, Harness } from '../helpers/goal-driver-harness';
import type { DriverDeps, GoalProbePort, GoalProbeWorkspace } from '../../../src/core/goal/driver';
import type { ProbeReport, ProbeRequest } from '../../../src/core/goal/probe';
import { validateProbeReport } from '../../../src/core/goal/probe';
import { nodeArtifactPaths, goalEvalArtifactPath } from '../../../src/core/goal/node-prompts';

function goalEval(): any {
  return {
    outcome: '探针结论能收敛计划假设',
    conditions: [
      { id: 'g1', statement: '最终计划引用了探针证据', required: true, evidence: 'waves.json + probe 报告', method: '读取产物' },
    ],
    mapping: { g1: { tasks: ['w1-t1'] } },
  };
}

function readyDoc(): any {
  return {
    status: 'ready',
    taskType: 'feature',
    waves: [{
      id: 'w1',
      title: '按探针结论实施',
      riskNote: '探针结论可能只覆盖主路径',
      tasks: [{ taskId: 'w1-t1', title: '落地方案', acceptance: ['npm test 全绿'] }],
    }],
    goalEval: goalEval(),
  };
}

function probeDraft(overrides: Record<string, unknown> = {}): any {
  return {
    question: '现有 store 能否在不改契约的前提下扩展？',
    hypothesis: '可以，新增可选字段即可',
    scope: { paths: ['src'], commandClasses: ['read', 'test'], network: false, credentials: [] },
    budget: { maxMinutes: 10, maxUsd: 1 },
    evidenceRequired: ['npm test 输出'],
    affects: { planAssertions: ['store 扩展不破坏契约'] },
    ...overrides,
  };
}

function needProbeDoc(probes: any[], overrides: Record<string, unknown> = {}): any {
  return { status: 'need_probe', probes, ...overrides };
}

function writePlan(h: Harness, goalId: string, doc: any, opts: { round?: number; revision?: number } = {}): string {
  const a = nodeArtifactPaths(h.mafwDir, goalId, opts.round ?? 1, { revision: opts.revision ?? 1 });
  fs.mkdirSync(path.dirname(a.waves), { recursive: true });
  fs.writeFileSync(a.waves, JSON.stringify(doc), 'utf-8');
  return a.waves;
}

const supportsReport: Omit<ProbeReport, 'probeId'> = {
  conclusion: 'supports',
  commands: ['npm test -- store'],
  keyOutput: 'tests passed: 12',
  repro: ['npm test -- store'],
  remainingAssumptions: ['只在 node 22 上验证'],
  impact: { plan: '可以新增可选字段', goalEval: 'g1 证据加上探针报告' },
};

interface FakeProbePort extends GoalProbePort {
  requests: ProbeRequest[];
  reports: Map<string, ProbeReport>;
  created: GoalProbeWorkspace[];
  disposed: GoalProbeWorkspace[];
  bindings: Array<[string, { request: ProbeRequest; workspaceDir?: string | null; projectDir?: string | null } | null]>;
  claimed: string[];
  failed: Array<{ id: string; reason: string }>;
  requeued: Array<{ id: string; reason?: string }>;
  /** 模拟外部（A2A / 命运路由）完成报告。 */
  completeReport(id: string, report?: Omit<ProbeReport, 'probeId'>): ProbeReport;
}

function makeProbePort(h: Harness, opts: { podId?: string | null; noWorkspace?: boolean } = {}): FakeProbePort {
  const requests: ProbeRequest[] = [];
  const reports = new Map<string, ProbeReport>();
  const created: GoalProbeWorkspace[] = [];
  const disposed: GoalProbeWorkspace[] = [];
  const bindings: FakeProbePort['bindings'] = [];
  const claimed: string[] = [];
  const failed: FakeProbePort['failed'] = [];
  const requeued: FakeProbePort['requeued'] = [];
  let seq = 0;

  const complete = (id: string, input: unknown): ProbeReport => {
    const report = validateProbeReport({ ...(input as any), probeId: id });
    reports.set(id, report);
    return report;
  };

  const port: FakeProbePort = {
    requests,
    reports,
    created,
    disposed,
    bindings,
    claimed,
    failed,
    requeued,
    podIdForGoal: () => (opts.podId === undefined ? 'pod1' : opts.podId),
    enqueue: ({ podId, goalId, revision, drafts }) => drafts.map((draft) => {
      seq += 1;
      const id = `p${seq}`;
      requests.push({
        id,
        podId,
        goalId,
        revision,
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
      if (!id) return null;
      const request = requests.find((r) => r.id === id) ?? null;
      if (request) claimed.push(id);
      return request;
    },
    report: (id) => reports.get(id) ?? null,
    complete,
    reportPath: (goalId, probeId) =>
      path.join(h.mafwDir, 'goals', goalId, 'probes', `${probeId}.report.json`),
    prepareWorkspace: async ({ goalId, probeId }) => {
      if (opts.noWorkspace) return null;
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), `mafw-probe-${goalId}-${probeId}-`));
      const ws: GoalProbeWorkspace = {
        dir,
        dispose: async () => {
          disposed.push(ws);
          fs.rmSync(dir, { recursive: true, force: true });
        },
      };
      created.push(ws);
      return ws;
    },
    disposeWorkspace: async (ws) => { await ws.dispose(); },
    bindSession: (sessionId, b) => { bindings.push([sessionId, b]); },
    failProbe: (id, reason) => {
      failed.push({ id, reason });
      reports.delete(id);
    },
    requeueProbe: (id, reason) => {
      requeued.push({ id, reason });
      reports.delete(id);
    },
    completeReport: (id, report = supportsReport) => complete(id, report),
  };
  return port;
}

function attachPort(h: Harness, port: FakeProbePort): DriverDeps {
  h.deps.probes = port;
  return h.deps;
}

function sessionOf(h: Harness) {
  return h.load('g1')!.nodeSession;
}

describe('two-stage Spike orchestration', () => {
  it('runs a Builder probe before the final plan and re-enters plan with probe refs', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);

    await h.driver.advance('g1');
    const planSid = sessionOf(h).id;
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(planSid);

    // 计划没有 ready → 没有批准，直接进 probe。
    let st = h.load('g1')!;
    expect(st.nextNode).toBe('probe');
    expect(st.planApproval).toBeUndefined();
    expect(st.probeQueue).toEqual(['p1']);

    // Builder（mafw-execute 身份）在隔离工作区里跑。
    const probeSid = sessionOf(h).id;
    expect(probeSid).not.toBe(planSid);
    expect(sessionOf(h).phase).toBe('probe');
    const prompt = h.calls.filter((c: any) => c.op === 'promptAsync').at(-1)!;
    expect(prompt.agent).toBe('mafw-execute');
    expect(prompt.parts[0].text).toContain(port.created[0].dir);
    expect(prompt.parts[0].text).toContain(port.requests[0].question);
    expect(prompt.parts[0].text).toContain(port.reportPath('g1', 'p1'));
    const create = h.calls.filter((c: any) => c.op === 'create').at(-1)!;
    expect(create.directory).toBe(port.created[0].dir);
    expect(port.bindings.at(-1)).toEqual([probeSid, expect.objectContaining({
      request: expect.objectContaining({ id: 'p1' }),
      workspaceDir: port.created[0].dir,
    })]);

    // 外部（A2A / 路由）完成报告 → 再次推进：回到 plan，报告进入 probeRefs。
    port.completeReport('p1');
    await h.driver.advance('g1');

    st = h.load('g1')!;
    expect(st.nextNode).toBe('plan');
    expect(st.probeRefs).toEqual(['p1']);
    expect(st.probeQueue).toEqual([]);
    expect(st.planApproval?.status ?? 'none').not.toBe('approved');
    expect(port.disposed).toHaveLength(1);
    expect(fs.existsSync(port.created[0].dir)).toBe(false);
    // 探针会话不该留下：完成即释放。
    expect(h.calls.filter((c: any) => c.op === 'delete').map((c: any) => c.sid)).toContain(probeSid);

    // 第二版计划必须看到证据与剩余假设。
    const planPrompt = h.calls.filter((c: any) => c.op === 'promptAsync').at(-1)!;
    expect(planPrompt.parts[0].text).toContain('Probe 报告');
    expect(planPrompt.parts[0].text).toContain('tests passed: 12');
    expect(planPrompt.parts[0].text).toContain('只在 node 22 上验证');
    // minors：探针额度也进计划上下文（模型知道还能申请几次）。
    expect(planPrompt.parts[0].text).toContain('探针额度');

    // 最终 ready 计划才进入批准门。
    const planSid2 = sessionOf(h).id;
    writePlan(h, 'g1', readyDoc());
    await h.fireIdle(planSid2);
    expect(h.load('g1')!.planApproval?.status).toBe('pending');
    expect(h.load('g1')!.probeRefs).toEqual(['p1']);
  });

  it('settles the probe node from Builder structured output and disposes the workspace', async () => {
    const reports = new Map<string, any>();
    const h = makeHarness({ structured: async (sid) => reports.get(sid) ?? null });
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);

    await h.driver.advance('g1');
    const planSid = sessionOf(h).id;
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(planSid);
    const probeSid = sessionOf(h).id;

    reports.set(probeSid, { ...supportsReport, conclusion: 'refutes' });
    await h.fireIdle(probeSid);

    const st = h.load('g1')!;
    expect(st.nextNode).toBe('plan');
    expect(st.probeRefs).toEqual(['p1']);
    expect(port.reports.get('p1')?.conclusion).toBe('refutes');
    expect(port.disposed).toHaveLength(1);
    expect(h.nodeRuns.filter((r: any) => r.node === 'probe')[0]).toMatchObject({
      status: 'succeeded',
      outcome: expect.stringContaining('refutes'),
    });
  });

  it('runs a batch of probes one at a time and only then returns to plan', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);

    await h.driver.advance('g1');
    writePlan(h, 'g1', needProbeDoc([probeDraft(), probeDraft({ question: '第二个问题' })]));
    await h.fireIdle(sessionOf(h).id);
    expect(h.load('g1')!.probeQueue).toEqual(['p1', 'p2']);

    port.completeReport('p1');
    await h.driver.advance('g1');
    let st = h.load('g1')!;
    expect(st.probeRefs).toEqual(['p1']);
    expect(st.probeQueue).toEqual(['p2']);
    expect(st.nextNode).toBe('probe');
    expect(sessionOf(h).phase).toBe('probe');
    expect(port.claimed).toEqual(['p1', 'p2']);

    port.completeReport('p2');
    await h.driver.advance('g1');
    st = h.load('g1')!;
    expect(st.probeRefs).toEqual(['p1', 'p2']);
    expect(st.nextNode).toBe('plan');
    expect(port.disposed).toHaveLength(2);
  });

  it('settles a probe whose report already landed before the session (recovery replay)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);
    const [id] = port.enqueue({ podId: 'pod1', goalId: 'g1', revision: 1, drafts: [probeDraft()] });
    expect(id).toBe('p1');
    port.completeReport('p1');
    h.write('g1', { nextNode: 'probe', probeQueue: ['p1'], nextAction: 'RUNNING_probe' });

    await h.driver.advance('g1');

    const st = h.load('g1')!;
    expect(st.probeRefs).toEqual(['p1']);
    expect(st.probeQueue).toEqual([]);
    expect(st.nextNode).toBe('plan');
    // 报告已在库：不需要再造工作区或 Builder 会话。
    expect(port.created).toHaveLength(0);
    expect(h.calls.filter((c: any) => c.op === 'promptAsync')).toHaveLength(1);
    expect(h.calls.filter((c: any) => c.op === 'promptAsync')[0].agent).toBe('mafw-plan');
  });

  it('fails closed when the plan asks for a probe outside the machine-readable scope', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    attachPort(h, makeProbePort(h));

    await h.driver.advance('g1');
    const planSid = sessionOf(h).id;
    writePlan(h, 'g1', needProbeDoc([probeDraft({
      scope: { paths: ['/etc'], commandClasses: ['read'], network: false, credentials: [] },
    })]));
    await h.fireIdle(planSid);

    expect(h.nodeRuns[0]).toMatchObject({ status: 'failed' });
    expect(h.nodeRuns[0].error).toContain('probe');
    expect(h.load('g1')!.probeQueue ?? []).toEqual([]);
    expect(h.load('g1')!.planApproval).toBeUndefined();
  });

  it('fails closed when the goal has no probe runner (non-Pod goal)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h, { podId: null });
    attachPort(h, port);

    await h.driver.advance('g1');
    const planSid = sessionOf(h).id;
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(planSid);

    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.nodeRuns[0].error).toContain('probe');
  });

  it('fails queued probes when the probe flow aborts (Pod binding lost after restart)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h, { podId: null });
    attachPort(h, port);

    // 计划已入队，但 Pod 绑定丢失（重启/迁移）：abort 必须把队列里的探针收尾。
    const [id] = port.enqueue({ podId: 'pod1', goalId: 'g1', revision: 1, drafts: [probeDraft()] });
    h.write('g1', { nextNode: 'probe', probeQueue: [id], nextAction: 'RUNNING_probe' });

    await h.driver.advance('g1');

    expect(port.failed.map((f) => f.id)).toEqual([id]);
    expect(h.load('g1')!.nextNode).toBe('archive_fail');
    expect(h.load('g1')!.probeQueue).toEqual([]);
  });

  it('fails the probe record when the isolated workspace cannot be prepared', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h, { noWorkspace: true });
    attachPort(h, port);

    await h.driver.advance('g1');
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(sessionOf(h).id);

    expect(port.failed.map((f) => f.id)).toEqual(['p1']);
    expect(h.load('g1')!.nextNode).toBe('archive_fail');
    expect(h.load('g1')!.probeQueue).toEqual([]);
  });

  it('caps probes per revision so a need_probe loop cannot run forever', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);
    h.write('g1', { probeRefs: ['x1', 'x2', 'x3', 'x4'] });

    await h.driver.advance('g1');
    const planSid = sessionOf(h).id;
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(planSid);

    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.nodeRuns[0].error).toContain('probe budget');
    expect(port.requests).toHaveLength(0);
  });
});

describe('probe budget is enforced', () => {
  it('hard-stops a probe that exceeds maxMinutes and disposes its workspace', async () => {
    const h = makeHarness({ maxAttempts: 1 });
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);

    await h.driver.advance('g1');
    writePlan(h, 'g1', needProbeDoc([probeDraft({ budget: { maxMinutes: 0.001, maxUsd: 1 } })]));
    await h.fireIdle(sessionOf(h).id);
    const probeSid = sessionOf(h).id;
    expect(probeSid).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 150));
    await new Promise((resolve) => setImmediate(resolve));

    const probeRun = h.nodeRuns.find((r: any) => r.node === 'probe')!;
    expect(probeRun.status).toBe('timeout');
    expect(probeRun.error).toContain('budget');
    expect(port.disposed).toHaveLength(1);
    // 超时是终态（attempts 用尽）→ 探针记录也必须收尾。
    expect(port.failed.map((f) => f.id)).toEqual(['p1']);
    // 预算耗尽 = 探针失败 → goal 归档失败（不会假装计划已完成）。
    expect(h.load('g1')!.nextNode).toBe('archive_fail');
  });

  it('requeues a retryable probe failure instead of leaving it running', async () => {
    const h = makeHarness(); // maxAttempts 2 → 429 可重试
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);

    await h.driver.advance('g1');
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(sessionOf(h).id);
    const first = sessionOf(h).id;

    await h.fireError(first, 'rate limited', '429');

    expect(port.requeued.map((r) => r.id)).toEqual(['p1']);
    expect(port.failed).toHaveLength(0);
    // 重试重新 claim 同一条探针（不会留下 running 幽灵，也不会开新 probe id）。
    expect(port.claimed).toEqual(['p1', 'p1']);
    expect(sessionOf(h)?.probeId).toBe('p1');
    expect(sessionOf(h)?.attempt).toBe(2);
  });
});

describe('probe fails without a report', () => {
  it('fails the probe node when the Builder produces no report and disposes the workspace', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const port = makeProbePort(h);
    attachPort(h, port);

    await h.driver.advance('g1');
    writePlan(h, 'g1', needProbeDoc([probeDraft()]));
    await h.fireIdle(sessionOf(h).id);
    const probeSid = sessionOf(h).id;

    await h.fireIdle(probeSid);
    const probeRun = h.nodeRuns.filter((r: any) => r.node === 'probe')[0];
    expect(probeRun.status).toBe('failed');
    expect(probeRun.error).toContain('report');
    expect(port.disposed).toHaveLength(1);
    expect(port.failed.map((f) => f.id)).toEqual(['p1']);
  });
});
