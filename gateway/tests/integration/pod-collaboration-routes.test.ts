/**
 * Task 18 contract/integration: collaboration routes.
 *
 * 真实服务（PodStore / PodTechLeadService / PodDirectionService / PodProbeService /
 * PodGoalService / PodGoalRevisionService）+ 真实 handler：覆盖直接讨论 Goal →
 * Tech Lead 会话 → 方向裁定 → 探针 → 打回 revision 2，以及 plan 响应的
 * goalEval/planHash/evalHash/revision 契约。
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../src/core/pod/pod-store';
import { PodService } from '../../src/core/pod/pod-service';
import { PodMemoryService } from '../../src/core/pod/pod-memory-service';
import { PodAccess } from '../../src/core/pod/pod-access';
import { PodSessionSupervisor } from '../../src/core/pod/pod-session-supervisor';
import { PodTechLeadService } from '../../src/core/pod/pod-tech-lead-service';
import { PodDirectionService } from '../../src/core/pod/pod-direction-service';
import { PodProbeService } from '../../src/core/pod/pod-probe-service';
import { PodGoalRevisionService } from '../../src/core/pod/pod-goal-revision-service';
import { PodGoalService } from '../../src/core/pod/pod-goal-service';
import type { PodGoalResult } from '../../src/core/pod/pod-result';
import { handlePods, type PodRouteDeps } from '../../src/routes/pods';
import {
  handlePodCollaboration,
  type PodCollaborationDeps,
} from '../../src/routes/pod-collaboration';
import { handleGoalPlan } from '../../src/routes/goal-plan';
import { ensureGoalState, loadGoalState } from '../../src/core/goal/state-v3';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';
import type { GoalEval } from '../../src/core/goal/goal-eval';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

const GOAL_EVAL: GoalEval = {
  outcome: '用户可以在桌面完成协作 Goal 全链路',
  conditions: [{
    id: 'c1',
    statement: '讨论 → 方向 → 计划 → 打回 全链路可用',
    required: true,
    evidence: 'e2e 测试通过',
    method: 'npx jest',
  }],
  failureConditions: [],
  constraints: [],
  nonGoals: [],
  mapping: { c1: { tasks: ['w1-t1'] } },
};

describe('pod collaboration routes (Task 18)', () => {
  let root: string;
  let projectDir: string;
  let mafwDir: string;
  let db: Database.Database;
  let store: PodStore;
  let pods: PodService;
  let podId: string;
  let techLead: PodTechLeadService;
  let directions: PodDirectionService;
  let probes: PodProbeService;
  let revisions: PodGoalRevisionService;
  let goals: PodGoalService;
  let access: PodAccess;
  let podDeps: PodRouteDeps;
  let collabDeps: PodCollaborationDeps;
  let promptCalls: Array<{ sessionID: string; text: string }>;
  let planning: string[];
  let resultForGoal: PodGoalResult;

  const now = '2026-11-03T00:00:00.000Z';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-collab-'));
    projectDir = path.join(root, 'project');
    mafwDir = path.join(root, 'mafw');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(mafwDir, { recursive: true });
    db = new Database(path.join(root, 'test.db'));
    store = new PodStore(db);

    const memory = new PodMemoryService({
      memoryRoot: path.join(root, 'pods'),
      now: () => now,
    });
    pods = new PodService({
      store,
      now: () => now,
      newId: (() => { let n = 0; return () => `id_${++n}`; })(),
      broadcast: () => {},
      getManagerSession: async () => 'ses_manager',
      getSession: async () => ({ time: { idle: 1 } }),
      messages: async () => [],
      memoryRoot: path.join(root, 'pods'),
      listRegisteredProjectDirs: () => [projectDir],
      ensureMemory: (id, name) => memory.ensurePodMemory(id, name),
    });
    const detail = await pods.ensure(projectDir);
    podId = detail.pod.id;

    const supervisor = new PodSessionSupervisor({
      store,
      now: () => now,
      isAlive: () => true,
    });
    promptCalls = [];
    let sessionSeq = 0;
    techLead = new PodTechLeadService({
      store,
      pods,
      sessions: supervisor,
      runtime: {
        createSession: async () => `ses_tech_${++sessionSeq}`,
        promptAsync: async ({ sessionID, parts }) => {
          promptCalls.push({ sessionID, text: parts.map((part) => part.text).join('') });
        },
        messages: async () => ({ data: [{ role: 'assistant', text: '讨论中' }] }),
      },
      resolveProject: () => ({ projectDir, mafwDir }),
      now: () => now,
      newId: (() => { let n = 0; return () => `tsk_${++n}`; })(),
      newGoalId: (() => { let n = 0; return () => `g${++n}`; })(),
      notify: () => {},
      log: () => {},
    });
    directions = new PodDirectionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => now,
      newId: (() => { let n = 0; return () => `dir_${++n}`; })(),
      notify: () => {},
      log: () => {},
    });
    probes = new PodProbeService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => now,
      newId: (() => { let n = 0; return () => `probe_${++n}`; })(),
      notify: () => {},
      log: () => {},
    });
    resultForGoal = {
      goalId: 'unknown',
      verdict: 'PASS',
      resultReady: true,
      goalAcceptance: [],
      tasks: [],
      reviewFeedback: 'ok',
      receipt: null,
      artifacts: [],
    };
    revisions = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => now,
      notify: () => {},
      resultForGoal: () => resultForGoal,
      log: () => {},
    });
    planning = [];
    goals = new PodGoalService({
      store,
      pods,
      startGoal: async () => {},
      resolveProjectDir: () => projectDir,
      now: () => now,
      newId: (() => { let n = 0; return () => `pg_${++n}`; })(),
      notify: () => {},
      revisions,
      techLead: { ensureSession: (goalId) => techLead.ensureSession(goalId) },
      directions: { recordRejectInput: (input) => directions.recordRejectInput(input) },
      log: () => {},
    });
    access = new PodAccess(store);

    podDeps = {
      pods,
      tasks: {} as any,
      messages: {} as any,
      goals,
      memory: memory as any,
      access,
      techLead,
      cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
      transcript: async () => ({}),
    };
    collabDeps = {
      pods,
      goals,
      techLead,
      directions,
      probes,
      revisions: { list: (id, goalId) => store.listGoalRevisions(id, goalId) },
      startPlanning: (goalId) => { planning.push(goalId); },
      access,
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function callPods(method: string, url: string, body?: any) {
    const res = mockRes();
    const handled = await handlePods(mockReq(method, body), res, url, podDeps);
    return { handled, res, json: res.body ? JSON.parse(res.body) : null };
  }

  async function call(method: string, url: string, body?: any) {
    const res = mockRes();
    const handled = await handlePodCollaboration(mockReq(method, body), res, url, collabDeps);
    return { handled, res, json: res.body ? JSON.parse(res.body) : null };
  }

  test('creates a discussing goal, opens the Tech Lead session, sends a message and rejects into revision 2', async () => {
    const created = await callPods('POST', `/api/pods/${podId}/goals`, {
      title: 'Loop',
      objective: '实现协作 Goal',
    });
    expect(created.res.status).toBe(200);
    expect(created.json).toMatchObject({
      status: 'discussing',
      podId,
      goalId: expect.any(String),
      revision: 1,
      stage: 'discussing',
    });
    expect(created.json.sessionID).toBeTruthy();
    const goalId = created.json.goalId;

    // 讨论 Goal 绝不进入 NodeDriver（startGoal 从未调用）且 Pod 当前目标就是它。
    expect(store.getActiveGoal(podId)?.goalId).toBe(goalId);
    expect(store.getGoalRevision(podId, goalId, 1)?.status).toBe('discussing');

    const techLeadHistory = await call('GET', `/api/pods/${podId}/goals/${goalId}/tech-lead`);
    expect(techLeadHistory.res.status).toBe(200);
    expect(techLeadHistory.json.sessionID).toBeTruthy();
    expect(techLeadHistory.json.revision).toBe(1);
    expect(Array.isArray(techLeadHistory.json.messages)).toBe(true);

    const sent = await call('POST', `/api/pods/${podId}/goals/${goalId}/tech-lead/messages`, {
      text: '讨论方向',
    });
    expect(sent.res.status).toBe(200);
    expect(sent.json.sessionID).toBeTruthy();
    expect(sent.json.text).toContain('讨论方向');
    expect(sent.json.text).toContain('CONTEXT MANIFEST');

    const rejected = await call('POST', `/api/pods/${podId}/goals/${goalId}/reject`, {
      feedback: '打回',
    });
    expect(rejected.res.status).toBe(200);
    expect(rejected.json.revision).toBe(2);
    expect(rejected.json.status).toBe('discussing');
    expect(rejected.json.sessionID).toBeTruthy();

    const revisions = await call('GET', `/api/pods/${podId}/goals/${goalId}/revisions`);
    expect(revisions.res.status).toBe(200);
    expect(revisions.json.items.map((row: any) => row.revision)).toEqual([1, 2]);
    expect(revisions.json.items[0]).toMatchObject({ status: 'completed', verdict: 'PASS' });
    expect(revisions.json.items[1]).toMatchObject({ status: 'discussing' });
  });

  test('direction decisions persist and start planning, needs_user asks for options', async () => {
    const created = await callPods('POST', `/api/pods/${podId}/goals`, {
      title: 'Direction',
      objective: '裁定方向',
    });
    const goalId = created.json.goalId;

    const missingOptions = await call(
      'POST',
      `/api/pods/${podId}/goals/${goalId}/direction-decision`,
      { mode: 'needs_user' },
    );
    expect(missingOptions.res.status).toBe(400);

    const review = await call('POST', `/api/pods/${podId}/goals/${goalId}/direction-decision`, {
      mode: 'needs_user',
      options: [{ id: 'a', title: '方案 A', risks: ['成本'] }],
      reason: '两种实现路线都需要用户确认',
    });
    expect(review.res.status).toBe(200);
    expect(review.json.directionStatus).toBe('pending');
    expect(review.json.planningStarted).toBe(false);
    expect(planning).toEqual([]);

    const decided = await call('POST', `/api/pods/${podId}/goals/${goalId}/direction-decision`, {
      mode: 'decided',
      userWords: '先做讨论界面',
    });
    expect(decided.res.status).toBe(200);
    expect(decided.json).toMatchObject({
      goalId,
      revision: 1,
      directionStatus: 'decided',
      planningStarted: true,
    });
    expect(decided.json.decision.userWords).toBe('先做讨论界面');
    expect(planning).toEqual([goalId]);
    expect(store.getGoalRevision(podId, goalId, 1)?.status).toBe('planning');

    // 幂等重放：同一条决定不重复追加。
    const replay = await call('POST', `/api/pods/${podId}/goals/${goalId}/direction-decision`, {
      mode: 'decided',
      userWords: '先做讨论界面',
    });
    expect(replay.json.state.decisions).toHaveLength(1);
  });

  test('probes are requestable, listable and validated', async () => {
    const created = await callPods('POST', `/api/pods/${podId}/goals`, {
      title: 'Probe',
      objective: '探针',
    });
    const goalId = created.json.goalId;

    const badStatus = await call('GET', `/api/pods/${podId}/goals/${goalId}/probes?status=bogus`);
    expect(badStatus.res.status).toBe(400);

    const unknownGoal = await call('GET', `/api/pods/${podId}/goals/nope/probes`);
    expect(unknownGoal.res.status).toBe(404);

    const probe = {
      question: 'Electron 42 支持 webview capturePage 吗？',
      hypothesis: '不支持，需要 desktopCapturer',
      scope: { paths: ['src'], commandClasses: ['test'], network: false, credentials: [] },
      budget: { maxMinutes: 10, maxUsd: 1 },
      evidenceRequired: ['npm test 输出'],
    };
    const single = await call('POST', `/api/pods/${podId}/goals/${goalId}/probes`, probe);
    expect(single.res.status).toBe(200);
    expect(single.json.items).toHaveLength(1);
    expect(single.json.items[0]).toMatchObject({ goalId, revision: 1, status: 'queued' });

    // 未通过校验的请求不落库（scope 为空 → 400）。
    const invalid = await call('POST', `/api/pods/${podId}/goals/${goalId}/probes`, {
      ...probe,
      scope: { paths: [], commandClasses: [], network: false, credentials: [] },
    });
    expect(invalid.res.status).toBe(400);
    expect((await call('GET', `/api/pods/${podId}/goals/${goalId}/probes`)).json.items).toHaveLength(1);

    const batch = await call('POST', `/api/pods/${podId}/goals/${goalId}/probes`, {
      probes: [{ ...probe, question: '第二条探针' }],
    });
    expect(batch.res.status).toBe(200);
    expect((await call('GET', `/api/pods/${podId}/goals/${goalId}/probes?revision=1`)).json.items).toHaveLength(2);
  });

  test('rejects unknown pods/goals and unsupported methods fall through', async () => {
    const created = await callPods('POST', `/api/pods/${podId}/goals`, {
      title: 'Errors',
      objective: '错误路径',
    });
    const goalId = created.json.goalId;

    expect((await call('GET', '/api/pods/nope/goals/x/tech-lead')).res.status).toBe(404);
    expect((await call('GET', `/api/pods/${podId}/goals/nope/tech-lead`)).res.status).toBe(404);
    expect((await call('POST', `/api/pods/${podId}/goals/${goalId}/reject`, {})).res.status).toBe(400);
    expect((await call('PUT', `/api/pods/${podId}/goals/${goalId}/revisions`)).handled).toBe(false);
    expect((await call('GET', '/api/pods/unrelated')).handled).toBe(false);

    // actor 校验：非成员会话不能打回（有 actor 时按角色门）。
    const foreign = await call('POST', `/api/pods/${podId}/goals/${goalId}/reject`, {
      feedback: '打回',
      actorSessionID: 'ses_foreign',
    });
    expect(foreign.res.status).toBe(403);
  });

  test('plan response exposes goalEval, planHash, evalHash and revision', async () => {
    const goalId = 'gp1';
    ensureGoalState(mafwDir, goalId, { projectDir, maxRounds: 3 });
    const wavesPath = nodeArtifactPaths(mafwDir, goalId, 1).waves;
    fs.mkdirSync(path.dirname(wavesPath), { recursive: true });
    fs.writeFileSync(wavesPath, JSON.stringify({
      status: 'ready',
      taskType: 'feature',
      waves: [{ id: 'w1', title: 'w', tasks: ['a'], riskNote: 'r' }],
      goalEval: GOAL_EVAL,
    }), 'utf-8');

    const res = mockRes();
    const handled = await handleGoalPlan(mockReq('GET'), res, `/api/goals/${goalId}/plan`, {
      loadState: (id) => loadGoalState(mafwDir, id),
      approvePlan: async () => true,
      rejectPlan: async () => true,
    });
    expect(handled).toBe(true);
    const json = JSON.parse(res.body);
    expect(json.revision).toBe(1);
    expect(json.goalEval).toMatchObject({ outcome: GOAL_EVAL.outcome });
    expect(json.goalEval.conditions[0].id).toBe('c1');
    expect(typeof json.planHash).toBe('string');
    expect(typeof json.evalHash).toBe('string');
    expect(json.waves.waves).toHaveLength(1);
  });
});
