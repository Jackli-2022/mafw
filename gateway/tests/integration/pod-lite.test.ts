import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore, PodError } from '../../src/core/pod/pod-store';
import { PodService } from '../../src/core/pod/pod-service';
import { PodTaskService } from '../../src/core/pod/pod-task-service';
import { PodMessageService } from '../../src/core/pod/pod-message-service';
import { PodMemoryService } from '../../src/core/pod/pod-memory-service';
import { PodGoalService } from '../../src/core/pod/pod-goal-service';
import { PodAccess } from '../../src/core/pod/pod-access';
import { PodBudget } from '../../src/core/pod/pod-budget';

describe('Pod Lite backend e2e', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let projectDir: string;
  let memoryRoot: string;
  let startGoal: jest.Mock;
  let pods: PodService;
  let tasks: PodTaskService;
  let messages: PodMessageService;
  let memory: PodMemoryService;
  let goals: PodGoalService;
  let access: PodAccess;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-e2e-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    projectDir = path.join(dir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    memoryRoot = path.join(dir, 'pods');
    memory = new PodMemoryService({ memoryRoot, now: () => '2026-10-29T12:00:00.000Z' });
    pods = new PodService({
      store,
      now: () => new Date().toISOString(),
      newId: (() => { let n = 0; return () => `id_${++n}`; })(),
      broadcast: () => {},
      getManagerSession: async () => 'ses_manager',
      getSession: async () => ({ time: { idle: 1 } }),
      messages: async () => [{ role: 'assistant', text: 'ok' }],
      memoryRoot,
      listRegisteredProjectDirs: () => [projectDir],
      ensureMemory: (podId, name) => memory.ensurePodMemory(podId, name),
    });
    tasks = new PodTaskService({
      store,
      now: () => new Date().toISOString(),
      newId: (() => { let n = 0; return () => `task_${++n}`; })(),
      notify: () => {},
    });
    messages = new PodMessageService({
      store,
      now: () => new Date().toISOString(),
      newId: (() => { let n = 0; return () => `msg_${++n}`; })(),
      notify: () => {},
    });
    startGoal = jest.fn(async () => {});
    goals = new PodGoalService({
      store,
      pods,
      startGoal,
      resolveProjectDir: () => projectDir,
      now: () => new Date().toISOString(),
      newId: (() => { let n = 0; return () => `pg_${++n}`; })(),
      notify: () => {},
    });
    access = new PodAccess(store);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('runs roster, queue, tasks, mailbox, memory, snapshot, access, and budget together', async () => {
    const detail = await pods.ensure(projectDir);
    expect(detail.members.map((m) => m.role)).toEqual(['lead', 'builder', 'reviewer']);

    const g1 = await goals.enqueueGoal('g1', projectDir);
    const g2 = await goals.enqueueGoal('g2', projectDir);
    expect(g1.status).toBe('started');
    expect(g2.status).toBe('queued');
    expect(startGoal).toHaveBeenCalledWith('g1', path.resolve(projectDir));

    const projected = tasks.projectWaves(detail.pod.id, 'g1', {
      waves: [{ id: 'w1', tasks: ['a', 'b'] }, { id: 'w2', tasks: ['c'] }],
    });
    expect(projected).toHaveLength(3);
    const receipt = tasks.applyReceipt(detail.pod.id, 'g1', {
      receipts: [{ taskId: 'w1-t1', status: 'done', files: ['a.ts'] }],
    });
    expect(receipt[0].status).toBe('review');
    tasks.reconcileArchive(detail.pod.id, 'g1', true);
    expect(tasks.list(detail.pod.id, 'g1').find((t) => t.externalTaskId === 'w1-t1')?.status).toBe('done');

    const lead = detail.members.find((m) => m.role === 'lead')!;
    const builder = detail.members.find((m) => m.role === 'builder')!;
    const message = messages.send({
      podId: detail.pod.id,
      fromMemberId: lead.id,
      toMemberId: builder.id,
      kind: 'request',
      body: 'please review',
    });
    expect(message.toMemberId).toBe(builder.id);

    const decisionPath = memory.captureGoal(detail.pod.id, {
      goalId: 'g1',
      ok: true,
      reviewFeedback: 'ok',
    });
    expect(fs.existsSync(decisionPath)).toBe(true);

    pods.bindSession('g1', 'execute', 'ses_builder');
    const transcript = await pods.snapshotSession('ses_builder');
    expect(transcript).toBeTruthy();
    expect(store.getSnapshot('ses_builder')).not.toBeNull();

    expect(access.requireMember('ses_manager', ['lead']).role).toBe('lead');
    expect(() => access.requireMember('ses_missing', ['lead'])).toThrow(PodError);

    const budget = new PodBudget({
      store,
      costForSessions: () => 10,
      dailyUsd: () => 5,
      nowEpoch: () => Math.floor(Date.now() / 1000),
    });
    expect(budget.canStart(detail.pod.id).ok).toBe(false);
    expect(new PodBudget({
      store,
      costForSessions: () => 10,
      dailyUsd: () => 0,
      nowEpoch: () => Math.floor(Date.now() / 1000),
    }).canStart(detail.pod.id).ok).toBe(true);

    await goals.onGoalArchived('g1');
    expect(store.getGoalByGoalId('g1')?.status).toBe('done');
    expect(store.getActiveGoal(detail.pod.id)?.goalId).toBe('g2');
    expect(startGoal).toHaveBeenLastCalledWith('g2', path.resolve(projectDir));
  });
});
