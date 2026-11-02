/**
 * Task 22 — end-to-end collaboration loop + migration checks.
 *
 * One scenario drives the real services (PodStore / PodService / PodTechLeadService /
 * PodDirectionService / PodProbeService / PodGoalRevisionService / PodGoalService /
 * PodContextSelectionService) and the real NodeDriver through:
 *
 *   direct Goal (discussing) → Lead→Tech Lead message → direction clear → plan need_probe
 *   → Builder probe (report) → plan ready (waves + goalEval) → human approval (hashes)
 *   → implement → review PASS → result → reject → revision 2 (revision 1 preserved).
 *
 * Migration checks cover: old three-role Pods (Tech Lead added, Lead/Manager binding
 * kept), legacy goals with no revision rows (revision 1 bootstrapped, old artifacts never
 * rewritten on reject), the legacy manager slot still readable while the projected Lead
 * session is hidden, and ContextManifest refusing another Goal's files.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../src/core/pod/pod-store';
import { PodService } from '../../src/core/pod/pod-service';
import { PodMemoryService } from '../../src/core/pod/pod-memory-service';
import { PodSessionSupervisor } from '../../src/core/pod/pod-session-supervisor';
import { PodTechLeadService } from '../../src/core/pod/pod-tech-lead-service';
import { PodDirectionService } from '../../src/core/pod/pod-direction-service';
import { PodProbeService, probeReportPath } from '../../src/core/pod/pod-probe-service';
import { PodGoalRevisionService } from '../../src/core/pod/pod-goal-revision-service';
import { PodGoalService } from '../../src/core/pod/pod-goal-service';
import { buildPodGoalResult } from '../../src/core/pod/pod-result';
import { PodContextSelectionService } from '../../src/mcp/handlers/pod-context-select';
import { makeHarness } from '../unit/helpers/goal-driver-harness';
import {
  ensureGoalState,
  loadGoalState,
  revisionStatePathFor,
  writeGoalState,
} from '../../src/core/goal/state-v3';
import { goalEvalArtifactPath, nodeArtifactPaths } from '../../src/core/goal/node-prompts';
import { readGoalRequest } from '../../src/core/goal/goal-intake';
import type { GoalEval } from '../../src/core/goal/goal-eval';
import type { GoalProbePort } from '../../src/core/goal/driver';
import { isHiddenSession, selectVisibleSessions } from '../../src/core/session-visibility';
import {
  projectLeadSessionMetadata,
  readManagerSlot,
} from '../../src/core/manager/manager-session-runtime';

const NOW = '2026-11-03T00:00:00.000Z';

function seq(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

function readText(target: string): string | null {
  try {
    return fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : null;
  } catch {
    return null;
  }
}

async function waitFor(
  check: () => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const GOAL_EVAL: GoalEval = {
  outcome: '用户可以在桌面完成协作 Goal 全链路',
  conditions: [{
    id: 'c1',
    statement: '讨论 → 方向 → 探针 → 计划 → 实施 → 评审 → 结果 全链路可用',
    required: true,
    evidence: 'e2e 测试通过',
    method: 'npx jest tests/integration/pod-collaboration-loop.test.ts',
  }],
  failureConditions: [],
  constraints: [],
  nonGoals: [],
  mapping: { c1: { tasks: ['w1-t1'] } },
};

function reviewReport(): string {
  return [
    '# Review',
    '',
    '```mafw-review',
    JSON.stringify({
      verdict: 'PASS',
      tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test: 3 suites passed' }],
      goalResults: [{ conditionId: 'c1', result: 'pass', evidence: 'e2e 全链路断言通过' }],
      feedback: '全链路通过',
    }, null, 2),
    '```',
    '',
  ].join('\n');
}

function planReadyDoc(): any {
  return {
    status: 'ready',
    taskType: 'feature',
    waves: [{
      id: 'w1',
      title: '实施协作闭环',
      riskNote: '探针只覆盖主路径',
      tasks: [{
        taskId: 'w1-t1',
        title: '实现并验证全链路',
        acceptance: ['npm test 全绿', 'revision 1 保留 PASS'],
      }],
    }],
    goalEval: GOAL_EVAL,
  };
}

function planNeedProbeDoc(): any {
  return {
    status: 'need_probe',
    taskType: 'feature',
    probes: [{
      question: '隔离工作区能跑测试吗？',
      hypothesis: '可以，工作区自带依赖',
      scope: { paths: ['src'], commandClasses: ['test'], network: false, credentials: [] },
      budget: { maxMinutes: 10, maxUsd: 1 },
      evidenceRequired: ['npm test 输出'],
      affects: { planAssertions: ['探针在隔离工作区执行'] },
    }],
  };
}

describe('pod collaborative goal loop (Task 22 e2e)', () => {
  let root: string;
  let projectDir: string;
  let mafwDir: string;
  let db: Database.Database;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-loop-'));
    projectDir = path.join(root, 'project');
    mafwDir = path.join(root, 'mafw');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(mafwDir, { recursive: true });
    db = new Database(path.join(root, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('direct Goal -> Tech Lead -> probe -> plan/eval -> approve -> implement -> review -> result -> reject revision 2', async () => {
    const store = new PodStore(db);
    const h = makeHarness();
    // NodeDriver state + Goal workspace live in the harness mafw dir (single source).
    mafwDir = h.mafwDir;
    const internalSessions: Array<{ id: string; role: string; identity?: string }> = [];
    const techPrompts: Array<{ sessionID: string; agent?: string; text: string }> = [];
    const archived: Array<{ goalId: string; verdict?: string }> = [];
    const archiveErrors: string[] = [];

    const memory = new PodMemoryService({ memoryRoot: path.join(root, 'pods'), now: () => NOW });

    const pods = new PodService({
      store,
      now: () => NOW,
      newId: seq('id'),
      broadcast: () => {},
      getManagerSession: async () => 'ses_manager',
      getSession: async () => ({ time: { idle: 1 } }),
      messages: async () => [],
      memoryRoot: path.join(root, 'pods'),
      listRegisteredProjectDirs: () => [projectDir],
      ensureMemory: (podId, name) => memory.ensurePodMemory(podId, name),
    });
    const detail = await pods.ensure(projectDir);
    const podId = detail.pod.id;

    const supervisor = new PodSessionSupervisor({ store, now: () => NOW, isAlive: () => true });

    let techSessionSeq = 0;
    const techLead = new PodTechLeadService({
      store,
      pods,
      sessions: supervisor,
      runtime: {
        createSession: async () => `ses_tech_${++techSessionSeq}`,
        promptAsync: async ({ sessionID, agent, parts }) => {
          techPrompts.push({ sessionID, agent, text: parts.map((part) => part.text).join('') });
        },
        messages: async () => ({ data: [] }),
      },
      resolveProject: () => ({ projectDir, mafwDir }),
      now: () => NOW,
      newId: seq('tsk'),
      registerInternalSession: (id, role, identity) => internalSessions.push({ id, role, identity }),
      notify: () => {},
      log: () => {},
    });

    const directions = new PodDirectionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => NOW,
      newId: seq('dir'),
      notify: () => {},
      log: () => {},
    });
    const probes = new PodProbeService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => NOW,
      newId: seq('probe'),
      notify: () => {},
      log: () => {},
    });

    const resultForGoal = (goalId: string) => {
      const state = loadGoalState(mafwDir, goalId);
      if (!state) return null;
      return buildPodGoalResult({
        goalId,
        state,
        request: readGoalRequest(mafwDir, goalId),
        readText,
      });
    };

    const revisions = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => NOW,
      notify: () => {},
      resultForGoal,
      log: () => {},
    });

    const goals = new PodGoalService({
      store,
      pods,
      startGoal: async () => {},
      resolveProjectDir: () => projectDir,
      now: () => NOW,
      newId: seq('pg'),
      notify: () => {},
      resultForGoal,
      revisions,
      techLead: { ensureSession: (goalId) => techLead.ensureSession(goalId) },
      directions: { recordRejectInput: (input) => directions.recordRejectInput(input) },
      log: () => {},
    });

    // Real finishPodGoal semantics: PASS archives, broadcasts one result, closes the Goal.
    h.deps.archiveGoal = async (goalId, outcome) => {
      archived.push({ goalId, verdict: outcome?.verdict });
      try {
        await goals.notifyResult(podId, goalId);
      } catch (err: any) {
        archiveErrors.push(`notify: ${err?.message ?? err}`);
      }
      await goals.onGoalArchived(goalId, { verdict: outcome?.verdict });
    };

    // Task 17: every worker prompt carries the real per-Goal ContextManifest.
    const contexts = new PodContextSelectionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => NOW,
      log: () => {},
    });
    h.deps.contextBlock = async (goalId, node, revision) =>
      contexts.renderForNode({ goalId, node, revision });

    // Task 14: wire the real PodProbeService behind the driver's probe port.
    const port: GoalProbePort = {
      podIdForGoal: (goalId) => store.findPodIdByGoal(goalId),
      enqueue: ({ podId, goalId, revision, drafts }) => probes.requestMany(
        drafts.map((draft) => ({ podId, goalId, revision, ...draft })),
      ).map((probe) => probe.id),
      take: ({ podId, goalId, probeIds }) =>
        probes.claimForGoal(podId, goalId, probeIds)?.request ?? null,
      report: (probeId) => {
        const row = store.getProbe(probeId);
        if (!row || row.status !== 'completed' || !row.reportJson) return null;
        try { return JSON.parse(row.reportJson); } catch { return null; }
      },
      complete: (probeId, report) => probes.complete(probeId, report),
      failProbe: (probeId, reason) => {
        try { probes.fail(probeId, reason); } catch { /* completed probes are untouched */ }
      },
      requeueProbe: (probeId, reason) => {
        try { probes.requeue(probeId, reason); } catch { /* fail-open */ }
      },
      reportPath: (goalId, probeId) => probeReportPath(mafwDir, goalId, probeId),
      prepareWorkspace: async ({ probeId }) => {
        const dir = fs.mkdtempSync(path.join(root, `probe-${probeId}-`));
        return {
          dir,
          dispose: async () => { fs.rmSync(dir, { recursive: true, force: true }); },
        };
      },
      disposeWorkspace: async (workspace) => { await workspace.dispose(); },
      bindSession: () => {},
    };
    h.deps.probes = port;

    // ── 1. direct discussion Goal (Lead → Tech Lead) ──────────────────────────
    const created = await techLead.createGoal({
      goalId: 'g_loop',
      title: 'Loop',
      objective: '实现端到端协作',
      planReview: 'manual',
    });
    const goalId = created.goalId;
    expect(created).toMatchObject({
      podId,
      goalId: 'g_loop',
      revision: 1,
      stage: 'discussing',
      status: 'discussing',
    });
    expect(created.sessionID).toBe('ses_tech_1');
    expect(store.getGoalRevision(podId, goalId, 1)?.status).toBe('discussing');
    expect(internalSessions).toContainEqual({
      id: 'ses_tech_1', role: 'tech_lead', identity: 'mafw-tech-lead',
    });

    // Asking the Tech Lead for a plan here must never start the NodeDriver.
    const sent = await techLead.prompt(goalId, '先调研，必要时跑探针');
    expect(sent.revision).toBe(1);
    expect(sent.text).toContain('[CONTEXT MANIFEST]');
    expect(sent.text).toContain('goal: g_loop');
    expect(sent.text).toContain('先调研，必要时跑探针');
    expect(techPrompts.at(-1)).toMatchObject({
      sessionID: 'ses_tech_1', agent: 'mafw-tech-lead',
    });

    ensureGoalState(mafwDir, goalId, { projectDir, maxRounds: 3, planReview: 'manual' });
    h.driver.registerGoalDir(goalId, mafwDir);
    const cleared = directions.markClear({ goalId, userWords: '先做端到端协作闭环' });
    expect(cleared.revisionStatus).toBe('planning');

    // ── 2. plan asks for a probe (two-stage) ─────────────────────────────────
    await h.driver.advance(goalId);
    let state = h.load(goalId);
    expect(state.nodeSession?.phase).toBe('plan');
    const firstPlanSession = state.nodeSession.id;
    const wavesPath = nodeArtifactPaths(mafwDir, goalId, 1, { revision: 1 }).waves;
    fs.mkdirSync(path.dirname(wavesPath), { recursive: true });
    fs.writeFileSync(wavesPath, JSON.stringify(planNeedProbeDoc()), 'utf-8');
    await h.fireIdle(firstPlanSession);

    // ── 3. Builder probe runs in an isolated workspace, report completes it ──
    await waitFor(() => h.load(goalId)?.nodeSession?.phase === 'probe', 'probe node');
    state = h.load(goalId);
    const probeId = state.probeQueue[0];
    const probeSession = state.nodeSession.id;
    expect(store.getProbe(probeId)?.status).toBe('running');
    // The Builder session was created inside the isolated probe workspace, not the project.
    const probeCreate = h.calls.filter((call) => call.op === 'create').at(-1);
    expect(probeCreate.directory).toContain('probe-');
    expect(probeCreate.directory).not.toBe(projectDir);

    probes.complete(probeId, {
      conclusion: 'supports',
      commands: ['npm test'],
      keyOutput: '3 suites passed',
      repro: [],
      remainingAssumptions: ['只在 Node 22 上验证'],
      impact: { plan: '按原计划实施' },
    });
    expect(fs.existsSync(probeReportPath(mafwDir, goalId, probeId))).toBe(true);
    await h.fireIdle(probeSession);

    // ── 4. plan #2 carries waves + goalEval, parks for human approval ────────
    await waitFor(() => h.load(goalId)?.nodeSession?.phase === 'plan', 'plan after probe');
    state = h.load(goalId);
    expect(state.probeRefs).toEqual([probeId]);
    expect(state.probeQueue).toEqual([]);
    const secondPlanSession = state.nodeSession.id;
    fs.writeFileSync(wavesPath, JSON.stringify(planReadyDoc()), 'utf-8');
    await h.fireIdle(secondPlanSession);

    await waitFor(() => h.load(goalId)?.nextAction === 'AWAIT_PLAN_APPROVAL', 'plan approval gate');
    state = h.load(goalId);
    expect(state.nodeSession).toBeNull();
    expect(state.planApproval).toMatchObject({ status: 'pending', revision: 1 });
    const approval = state.planApproval;
    expect(approval.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approval.evalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(goalEvalArtifactPath(mafwDir, goalId, 1))).toBe(true);

    // ── 5. approve the exact plan/eval the user saw ──────────────────────────
    await expect(h.driver.approvePlan(goalId, approval.id, {
      planHash: approval.planHash,
      evalHash: approval.evalHash,
    })).resolves.toBe(true);
    await waitFor(() => h.load(goalId)?.nodeSession?.phase === 'execute', 'execute node');

    const receiptPath = nodeArtifactPaths(mafwDir, goalId, 1, { revision: 1 }).receipt;
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({
      goalId,
      receipts: [{ taskId: 'w1-t1', files: ['src/loop.ts'], summary: 'implemented' }],
    }), 'utf-8');
    await h.fireIdle(h.load(goalId)!.nodeSession.id);

    // ── 6. independent review PASS covers tasks + required goal conditions ───
    await waitFor(() => h.load(goalId)?.nodeSession?.phase === 'review', 'review node');
    const reviewPath = nodeArtifactPaths(mafwDir, goalId, 1, { revision: 1 }).review;
    fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
    fs.writeFileSync(reviewPath, reviewReport(), 'utf-8');
    await h.fireIdle(h.load(goalId)!.nodeSession.id);

    await waitFor(
      () => store.getGoalRevision(podId, goalId, 1)?.status === 'completed',
      'revision 1 completed',
    );
    expect(archiveErrors).toEqual([]);
    expect(archived).toEqual([{ goalId, verdict: 'PASS' }]);
    expect(store.getGoalByGoalId(goalId)).toMatchObject({ status: 'done', verdict: 'PASS' });

    // ── 7. result view: verdict PASS, evidence-backed, revision 1 ────────────
    const result = goals.result(podId, goalId);
    expect(result).toMatchObject({ revision: 1, verdict: 'PASS', resultReady: true, failure: null });
    expect(result.tasks).toEqual([
      { taskId: 'w1-t1', result: 'pass', evidence: 'npm test: 3 suites passed' },
    ]);
    expect(result.goalResults).toEqual([
      { conditionId: 'c1', result: 'pass', evidence: 'e2e 全链路断言通过' },
    ]);

    const wavesBefore = fs.readFileSync(wavesPath, 'utf-8');
    const reviewBefore = fs.readFileSync(reviewPath, 'utf-8');

    // ── 8. reject → revision 2 discussing; revision 1 stays PASS ─────────────
    const rejected = await goals.rejectResult(podId, goalId, '方向不对，继续讨论');
    expect(rejected).toMatchObject({ revision: 2, status: 'discussing' });
    expect(rejected.priority).toBeGreaterThan(0);
    expect(rejected.sessionID).toBe('ses_tech_2');
    expect(internalSessions.filter((item) => item.id === 'ses_tech_2')).toEqual([
      { id: 'ses_tech_2', role: 'tech_lead', identity: 'mafw-tech-lead' },
    ]);

    expect(store.getGoalByGoalId(goalId)?.activeRevision).toBe(2);
    expect(store.getGoalRevision(podId, goalId, 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
    });
    expect(store.getGoalRevision(podId, goalId, 2)).toMatchObject({ status: 'discussing' });

    // Revision 1 artifacts and its archived state are append-only.
    expect(fs.readFileSync(wavesPath, 'utf-8')).toBe(wavesBefore);
    expect(fs.readFileSync(reviewPath, 'utf-8')).toBe(reviewBefore);
    const archivedStatePath = revisionStatePathFor(mafwDir, goalId, 1);
    expect(fs.existsSync(archivedStatePath)).toBe(true);
    const archivedState = JSON.parse(fs.readFileSync(archivedStatePath, 'utf-8'));
    expect(archivedState).toMatchObject({ revision: 1, reviewVerdict: 'PASS', nextAction: 'COMPLETED' });

    const oldRevision = buildPodGoalResult({
      goalId,
      state: archivedState,
      request: readGoalRequest(mafwDir, goalId),
      readText,
      revision: 1,
    });
    expect(oldRevision).toMatchObject({ revision: 1, verdict: 'PASS', resultReady: true });

    const freshState = loadGoalState(mafwDir, goalId)!;
    expect(freshState).toMatchObject({ revision: 2, reviewVerdict: null, nextAction: 'RUNNING_plan' });
    expect(store.listGoalRevisions(podId, goalId).map((row) => row.revision)).toEqual([1, 2]);

    // Reject feedback becomes a direction input on the new revision (append-only).
    const directionState = directions.state(goalId, 2);
    expect(directionState.decisions.some(
      (decision) => decision.source === 'reject_feedback'
        && decision.userWords.includes('方向不对'),
    )).toBe(true);

    // ── 9. ContextManifest never leaks another Goal ──────────────────────────
    expect(isHiddenSession({ id: 'ses_tech_1', agent: 'mafw-tech-lead' })).toBe(true);
    expect(isHiddenSession({ metadata: projectLeadSessionMetadata() })).toBe(true);

    await techLead.createGoal({ goalId: 'g_other', title: 'Other', objective: '另一个目标' });
    fs.writeFileSync(path.join(mafwDir, 'goals', 'g_other', 'notes.md'), '# other goal notes', 'utf-8');

    const ownContext = await contexts.select({ goalId, refs: [] }, 'ses_manager');
    expect(ownContext.block).toContain('goal: g_loop');
    expect(ownContext.block).not.toContain('g_other');
    expect(ownContext.block).not.toContain('another goal');

    await expect(contexts.select(
      { goalId, add: [{ path: 'g_other/notes.md' }] },
      'ses_manager',
    )).rejects.toThrow(/cross-goal reference not allowed/);
    expect(contexts.selection(goalId, 2)?.refs ?? []).toEqual([]);

    // Worker prompts only ever carried this Goal's manifest.
    const workerPrompts = h.calls.filter((call) => call.op === 'promptAsync');
    expect(workerPrompts.length).toBeGreaterThan(0);
    for (const call of workerPrompts) {
      expect(call.parts[0].text).toContain('[CONTEXT MANIFEST]');
      expect(call.parts[0].text).toContain('goal: g_loop');
      expect(call.parts[0].text).not.toContain('g_other');
    }
  });
});

describe('pod collaboration migration checks (Task 22)', () => {
  test('an old three-role Pod gains a Tech Lead without losing Lead/Builder/Reviewer or the manager slot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-legacy-roles-'));
    const projectDir = path.join(root, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    const db = new Database(path.join(root, 'test.db'));

    // Old Pod: three roles only, manager bound as Lead, a legacy goal with no revision row.
    const oldStore = new PodStore(db);
    const pod = oldStore.ensurePod({
      id: 'pod_old', projectDir, name: 'old-project', now: NOW,
    });
    for (const role of ['lead', 'builder', 'reviewer'] as const) {
      oldStore.upsertMember({
        id: `member_${role}`,
        podId: pod.id,
        role,
        displayName: role,
        agentName: role === 'lead' ? 'manager' : `mafw-${role}`,
        modelProvider: null,
        modelId: null,
        status: 'available',
        configJson: null,
        now: NOW,
      });
    }
    oldStore.enqueueGoal({ id: 'pg_old', podId: pod.id, goalId: 'g_old', now: NOW });
    db.prepare('DELETE FROM pod_goal_revisions').run();

    // Re-opening the store runs the legacy bootstrap (revision 1 + role upgrade on ensure).
    const store = new PodStore(db);
    const migratedGoal = store.getGoal(pod.id, 'g_old');
    expect(migratedGoal).toMatchObject({ id: 'pg_old', activeRevision: 1, priority: 0 });
    expect(store.listGoalRevisions(pod.id, 'g_old')).toEqual([
      expect.objectContaining({ revision: 1, status: 'queued', verdict: null }),
    ]);

    const pods = new PodService({
      store,
      now: () => NOW,
      newId: seq('id'),
      broadcast: () => {},
      getManagerSession: async () => 'ses_manager',
      getSession: async () => ({ time: { idle: 1 } }),
      messages: async () => [],
      memoryRoot: path.join(root, 'pods'),
      listRegisteredProjectDirs: () => [projectDir],
    });
    const detail = await pods.ensure(projectDir);
    expect(detail.members.map((member) => member.role)).toEqual([
      'lead', 'tech_lead', 'builder', 'reviewer',
    ]);
    // Old member ids survive; only the missing Tech Lead is added.
    expect(detail.members.find((member) => member.role === 'lead')?.id).toBe('member_lead');
    expect(detail.members.find((member) => member.role === 'builder')?.id).toBe('member_builder');
    expect(detail.members.find((member) => member.role === 'reviewer')?.id).toBe('member_reviewer');
    expect(detail.members.find((member) => member.role === 'tech_lead')?.agentName).toBe('mafw-tech-lead');
    // The legacy manager session binds as Lead (Manager role is not user-facing anymore).
    expect(store.getMemberBySession('ses_manager')).toMatchObject({
      role: 'lead', podId: pod.id,
    });

    // Old manager slot stays readable; the projected Lead session is hidden from lists.
    const managerSlot = { byRuntime: { opencode: { sessionId: 'ses_manager' } } };
    expect(readManagerSlot(managerSlot, 'opencode')?.sessionId).toBe('ses_manager');
    const leadMetadata = projectLeadSessionMetadata();
    expect(isHiddenSession({ id: 'ses_manager', metadata: leadMetadata })).toBe(true);
    const visible = selectVisibleSessions({
      fromServe: [
        { id: 'ses_manager', title: 'Lead', metadata: leadMetadata },
        { id: 'ses_user', title: '普通会话' },
      ],
      localSessions: [
        { id: 'ses_manager', title: 'Lead', metadata: leadMetadata, projectID: projectDir, directory: projectDir },
        { id: 'ses_user', title: '普通会话', projectID: projectDir, directory: projectDir },
      ],
      projectID: projectDir,
    });
    expect(visible.map((session) => session.id)).toEqual(['ses_user']);
    // Legacy `manager` rows remain readable (compat), never hidden by accident.
    expect(isHiddenSession({ id: 'ses_legacy', metadata: { mafw: { role: 'manager' } } })).toBe(false);

    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a legacy goal rejects into revision 2 without rewriting revision-1 artifacts or its PASS verdict', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-legacy-goal-'));
    const projectDir = path.join(root, 'project');
    const mafwDir = path.join(root, 'mafw');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'goals', 'g_legacy'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'reviews'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
    const db = new Database(path.join(root, 'test.db'));
    const goalId = 'g_legacy';

    // Legacy artifacts: charter/request, rev-1 waves at the mafw root, eval in the Goal dir.
    fs.writeFileSync(path.join(mafwDir, 'goals', goalId, 'goal.md'), '# Legacy goal\n', 'utf-8');
    fs.writeFileSync(path.join(mafwDir, 'requests', `${goalId}.json`), JSON.stringify({
      title: 'Legacy goal',
      acceptance: ['旧目标仍然可用'],
      planReview: 'manual',
    }), 'utf-8');
    const wavesPath = path.join(mafwDir, 'waves.json');
    fs.writeFileSync(wavesPath, JSON.stringify({
      waves: [{ id: 'w1', title: '旧计划', tasks: ['legacy task'] }],
    }, null, 2), 'utf-8');
    fs.writeFileSync(path.join(mafwDir, 'goals', goalId, 'goal-eval.json'), JSON.stringify({
      ...GOAL_EVAL,
      mapping: { c1: { tasks: ['w1-t1'] } },
    }), 'utf-8');
    const reviewPath = path.join(mafwDir, 'reviews', `${goalId}-loop1.md`);
    fs.writeFileSync(reviewPath, reviewReport(), 'utf-8');
    ensureGoalState(mafwDir, goalId, { projectDir, maxRounds: 3, planReview: 'manual' });
    writeGoalState(mafwDir, goalId, {
      reviewVerdict: 'PASS',
      phase: 'ARCHIVED',
      nextAction: 'COMPLETED',
      wavePlanPath: wavesPath,
      reviewReportPath: reviewPath,
    });

    const oldStore = new PodStore(db);
    const pod = oldStore.ensurePod({ id: 'pod_legacy', projectDir, name: 'legacy', now: NOW });
    const row = oldStore.enqueueGoal({ id: 'pg_legacy', podId: pod.id, goalId, now: NOW });
    oldStore.setGoalStatus(row.id, 'done', { endedAt: NOW, verdict: 'PASS' });
    db.prepare('DELETE FROM pod_goal_revisions').run();

    // Legacy bootstrap: revision 1 appears with the root verdict; nothing is invented.
    const store = new PodStore(db);
    expect(store.getGoal(pod.id, goalId)).toMatchObject({ activeRevision: 1, status: 'done', verdict: 'PASS' });
    expect(store.getGoalRevision(pod.id, goalId, 1)).toMatchObject({
      status: 'completed', verdict: 'PASS',
    });

    const resultForGoal = (id: string) => {
      const state = loadGoalState(mafwDir, id);
      return state ? buildPodGoalResult({
        goalId: id, state, request: readGoalRequest(mafwDir, id), readText,
      }) : null;
    };
    const revisions = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => NOW,
      notify: () => {},
      resultForGoal,
      log: () => {},
    });

    const wavesBefore = fs.readFileSync(wavesPath, 'utf-8');
    const reviewBefore = fs.readFileSync(reviewPath, 'utf-8');
    const reopened = await revisions.reopenAfterReject(goalId, '旧版方向不对，重新讨论');

    expect(reopened).toMatchObject({ opened: true, revision: 2, status: 'discussing' });
    expect(reopened.evidence).toMatchObject({ source: 'result', verdict: 'PASS', resultReady: true });
    expect(store.getGoal(pod.id, goalId)?.activeRevision).toBe(2);
    expect(store.getGoalRevision(pod.id, goalId, 1)).toMatchObject({
      status: 'completed', verdict: 'PASS',
    });
    expect(store.getGoalRevision(pod.id, goalId, 2)).toMatchObject({ status: 'discussing' });
    // Append-only: legacy revision-1 artifacts and its archived state are untouched.
    expect(fs.readFileSync(wavesPath, 'utf-8')).toBe(wavesBefore);
    expect(fs.readFileSync(reviewPath, 'utf-8')).toBe(reviewBefore);
    const archived = JSON.parse(
      fs.readFileSync(revisionStatePathFor(mafwDir, goalId, 1), 'utf-8'),
    );
    expect(archived).toMatchObject({ revision: 1, reviewVerdict: 'PASS', nextAction: 'COMPLETED' });
    expect(loadGoalState(mafwDir, goalId)).toMatchObject({
      revision: 2, reviewVerdict: null, nextAction: 'RUNNING_plan',
    });

    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
