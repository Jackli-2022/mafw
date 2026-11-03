import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore, type PodGoalRevisionStatus } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';
import {
  REJECT_REVISION_PRIORITY,
  PodGoalRevisionService,
} from '../../../src/core/pod/pod-goal-revision-service';
import {
  PodDirectionService,
  directionArtifactPath,
} from '../../../src/core/pod/pod-direction-service';
import type { PodGoalDescription } from '../../../src/core/pod/pod-view';
import type { PodGoalResult } from '../../../src/core/pod/pod-result';
import {
  ensureGoalState,
  loadGoalState,
  revisionStatePathFor,
  writeGoalState,
} from '../../../src/core/goal/state-v3';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:15:00.000Z';

type EmittedEvent = { type: string; properties: Record<string, unknown> };

function goalResult(verdict: 'PASS' | 'FAIL' | null, revision = 1, goalId = 'g1'): PodGoalResult {
  return {
    goalId,
    revision,
    verdict,
    resultReady: verdict !== null,
    goalAcceptance: ['the goal works'],
    goalConditions: [],
    goalResults: [],
    goalEvalValid: true,
    failure: null,
    tasks: [],
    reviewFeedback: verdict === 'PASS' ? 'all conditions met' : '',
    receipt: null,
    artifacts: [],
  };
}

describe('PodGoal result notification and reject', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let mafwDir: string;
  let events: EmittedEvent[];
  let result: PodGoalResult | null;
  let techLead: { ensureSession: jest.Mock };
  let sessions: { retireRevision: jest.Mock };
  let revisions: PodGoalRevisionService;
  let directions: PodDirectionService;
  let service: PodGoalService;

  const emit = (podId: string, kind?: string, goalId?: string): void => {
    events.push({
      type: 'pod.updated',
      properties: { podId, ...(kind ? { kind } : {}), ...(goalId ? { goalId } : {}) },
    });
  };

  const resultEvents = () => events.filter((event) => event.properties.kind === 'result');

  const describeGoal = (goalId: string): PodGoalDescription => {
    const row = store.getGoal('pod_1', goalId);
    return {
      title: 'Ship the collaboration loop',
      phase: 'COMPLETED',
      nextAction: 'COMPLETED',
      terminal: false,
      verdict: 'PASS',
      hasResultEvidence: true,
      planApproval: null,
      pendingQuestion: null,
      nodeSession: null,
      lastError: null,
      revision: row?.activeRevision ?? 1,
    };
  };

  const seedGoal = (patch: { status?: 'queued' | 'active' | 'done'; verdict?: string | null } = {}) => {
    const row = store.enqueueGoal({ id: 'pg_g1', podId: 'pod_1', goalId: 'g1', now: NOW });
    const status = patch.status ?? 'active';
    store.setGoalStatus(row.id, status, {
      startedAt: NOW,
      ...(status === 'done' ? { endedAt: NOW, verdict: patch.verdict ?? 'PASS' } : {}),
    });
    if (status === 'active') {
      store.updatePod('pod_1', { status: 'active', activeGoalId: 'g1' }, NOW);
    }
  };

  const seedRevision = (
    revision: number,
    status: PodGoalRevisionStatus,
    patch: { verdict?: string | null; endedAt?: string | null } = {},
  ) => store.createGoalRevision({
    podId: 'pod_1',
    goalId: 'g1',
    revision,
    status,
    priority: 0,
    verdict: patch.verdict ?? null,
    endedAt: patch.endedAt ?? null,
    now: NOW,
  });

  const seedCompletedState = (revision = 1): void => {
    ensureGoalState(mafwDir, 'g1', { revision, projectDir: '/proj/a', maxRounds: 3 });
    writeGoalState(mafwDir, 'g1', {
      nextAction: 'COMPLETED',
      phase: 'COMPLETED',
      reviewVerdict: 'PASS',
    });
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-result-reject-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    mafwDir = path.join(dir, 'mafw');
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    events = [];
    result = null;
    techLead = { ensureSession: jest.fn(async () => 'sess_tl') };
    sessions = { retireRevision: jest.fn(async () => true) };

    revisions = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => LATER,
      resultForGoal: () => result,
      notify: emit,
    });
    directions = new PodDirectionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => LATER,
      newId: () => `dirreq_${Math.random().toString(16).slice(2, 8)}`,
    });
    service = new PodGoalService({
      store,
      pods: { ensure: jest.fn() } as any,
      startGoal: jest.fn(async () => {}),
      resolveProjectDir: () => '/proj/a',
      now: () => LATER,
      newId: () => `pg_${Math.random().toString(36).slice(2, 8)}`,
      notify: emit,
      describeGoal: (goalId) => describeGoal(goalId),
      resultForGoal: () => result,
      revisions,
      sessions,
      techLead: techLead as any,
      directions: directions as any,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('notifyResult emits one result event and never creates attention', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'completed', { verdict: 'PASS', endedAt: NOW });
    result = goalResult('PASS');

    const notified = await service.notifyResult('pod_1', 'g1');

    expect(notified).toMatchObject({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      verdict: 'PASS',
      notified: true,
      duplicate: false,
    });
    expect(events).toEqual([
      { type: 'pod.updated', properties: { podId: 'pod_1', kind: 'result', goalId: 'g1' } },
    ]);
    expect(service.attention('pod_1')).toEqual([]);
    expect(service.views('pod_1')[0].stage).toMatchObject({ owner: 'team', kind: 'result_notified' });
    // 完成结果被保留：revision 仍是真实 PASS，绝不因为「通知」被改写。
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
      endedAt: NOW,
    });
  });

  test('notifyResult retires the completed revision lease', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'reviewing');
    result = goalResult('PASS');

    await service.notifyResult('pod_1', 'g1');

    expect(sessions.retireRevision).toHaveBeenCalledWith('g1', 1);
  });

  test('notifyResult records completion with the evidence verdict for a still-running revision', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'reviewing');
    result = goalResult('PASS');

    await service.notifyResult('pod_1', 'g1');

    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
      endedAt: LATER,
    });
    expect(resultEvents()).toHaveLength(1);
  });

  test('notifyResult refuses a goal without result evidence', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'discussing');
    result = null;

    await expect(service.notifyResult('pod_1', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(events).toEqual([]);
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({ status: 'discussing' });
    await expect(service.notifyResult('pod_1', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  test('notifyResult emits at most one result event per revision', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'completed', { verdict: 'PASS', endedAt: NOW });
    result = goalResult('PASS');

    await service.notifyResult('pod_1', 'g1');
    const replay = await service.notifyResult('pod_1', 'g1');

    expect(replay).toMatchObject({ notified: false, duplicate: true, revision: 1 });
    expect(resultEvents()).toHaveLength(1);
  });

  test('rejectResult closes the finished revision and opens a discussing revision', async () => {
    seedGoal({ status: 'done', verdict: 'PASS' });
    seedRevision(1, 'completed', { verdict: 'PASS', endedAt: NOW });
    seedCompletedState(1);
    result = goalResult('PASS');

    const rejected = await service.rejectResult('pod_1', 'g1', '方向不对，重新讨论');

    expect(rejected).toMatchObject({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 2,
      status: 'discussing',
      priority: REJECT_REVISION_PRIORITY,
      feedback: '方向不对，重新讨论',
      sessionID: 'sess_tl',
    });
    // 同一 Goal 继续：根记录回到进行中，旧的终态 verdict / 结束时间不再冒充当前结果。
    expect(store.getGoal('pod_1', 'g1')).toMatchObject({
      activeRevision: 2,
      status: 'active',
      verdict: null,
      endedAt: null,
      priority: REJECT_REVISION_PRIORITY,
    });
    // 旧 revision 原样保留（append-only：verdict / feedback / endedAt 都不改写）。
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
      feedback: null,
      endedAt: NOW,
    });
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      status: 'discussing',
      feedback: '方向不对，重新讨论',
      priority: REJECT_REVISION_PRIORITY,
      endedAt: null,
    });
    expect(store.listQueuedGoalRevisions('pod_1')[0]).toMatchObject({ goalId: 'g1', revision: 2 });
    expect(service.attention('pod_1')).toEqual([]);
    // 旧 state 归档成快照，新 active state 属于 revision 2。
    expect(JSON.parse(fs.readFileSync(revisionStatePathFor(mafwDir, 'g1', 1), 'utf-8')))
      .toMatchObject({ nextAction: 'COMPLETED', reviewVerdict: 'PASS' });
    expect(loadGoalState(mafwDir, 'g1')?.revision).toBe(2);
    // Tech Lead 讨论立即恢复。
    expect(techLead.ensureSession).toHaveBeenCalledWith('g1');
    // 打回反馈作为方向决定的输入记录在新 revision（原话逐字保留，不推动阶段）。
    const artifact = JSON.parse(fs.readFileSync(directionArtifactPath(mafwDir, 'g1'), 'utf-8'));
    expect(artifact.revisions['2'].decisions[0]).toMatchObject({
      source: 'reject_feedback',
      userWords: '方向不对，重新讨论',
      revision: 2,
      optionId: null,
    });
    expect(store.getGoalRevision('pod_1', 'g1', 2)?.directionStatus).toBe('none');
  });

  test('rejectResult finishes an in-flight revision with the result evidence first', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'implementing');
    seedCompletedState(1);
    result = goalResult('PASS');

    const rejected = await service.rejectResult('pod_1', 'g1', '请补一轮验收');

    expect(rejected).toMatchObject({ revision: 2, status: 'discussing' });
    // HARD PREREQUISITE：先带证据收尾（真实 verdict），再开下一 revision。
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
      endedAt: LATER,
    });
  });

  test('a replayed reject does not burn a revision', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'implementing');
    seedCompletedState(1);
    result = goalResult('PASS');

    await service.rejectResult('pod_1', 'g1', '再来一次');
    // 新 revision 还没有任何结果：重放必须被拒绝，而不是再开一版。
    result = null;

    await expect(service.rejectResult('pod_1', 'g1', '再来一次')).rejects.toMatchObject({ status: 409 });
    expect(store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision)).toEqual([1, 2]);
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(2);
    expect(store.getGoalRevision('pod_1', 'g1', 2)).toMatchObject({
      status: 'discussing',
      endedAt: null,
    });
    expect(fs.existsSync(revisionStatePathFor(mafwDir, 'g1', 2))).toBe(false);
    expect(techLead.ensureSession).toHaveBeenCalledTimes(1);
  });

  test('rejectResult requires feedback and an existing goal', async () => {
    seedGoal({ status: 'active' });
    seedRevision(1, 'completed', { verdict: 'PASS', endedAt: NOW });
    result = goalResult('PASS');

    await expect(service.rejectResult('pod_1', 'g1', '   ')).rejects.toMatchObject({ status: 400 });
    await expect(service.rejectResult('pod_1', 'nope', 'feedback')).rejects.toMatchObject({ status: 404 });
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(1);
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({ status: 'completed', verdict: 'PASS' });
  });

  test('gateway wires the revision service, result notification and reject dependencies', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf-8');
    expect(source).toContain('new PodGoalRevisionService(');
    expect(source).toMatch(/revisions: this\.podGoalRevisionService/);
    expect(source).toMatch(/techLead: \{ ensureSession:/);
    expect(source).toMatch(/directions: \{ recordRejectInput:/);
    // PASS 归档后发一条结果通知（无 attention / 无二次验收）。
    expect(source).toMatch(/outcome\?\.verdict === 'PASS'[\s\S]{0,300}notifyResult\(podId, goalId\)/);
  });
});
