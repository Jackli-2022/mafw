import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore, type PodRow } from '../../../src/core/pod/pod-store';
import { PodGoalService, type PodGoalServiceDeps } from '../../../src/core/pod/pod-goal-service';
import type { PodDetail } from '../../../src/core/pod/pod-service';

describe('PodGoalService', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let startGoal: jest.Mock;
  let notifications: string[];
  let projectDir: string;
  let service: PodGoalService;

  function detailFor(pod: PodRow): PodDetail {
    return {
      pod,
      members: store.listMembers(pod.id),
      goals: store.listGoals(pod.id),
      tasks: store.listTasks(pod.id),
      sessions: store.listSessions(pod.id),
    };
  }

  function makeService(
    budget?: { canStart(podId: string): { ok: boolean; spentUsd: number; limitUsd: number } },
    extra: Partial<PodGoalServiceDeps> = {},
  ) {
    const pods = {
      ensure: jest.fn(async (requested: string) => {
        const canonical = path.resolve(requested);
        const existing = store.getPodByProject(canonical);
        const pod = existing ?? store.ensurePod({
          id: 'pod_1',
          projectDir: canonical,
          name: 'Project',
          now: '2026-10-29T00:00:00.000Z',
        });
        return detailFor(pod);
      }),
    } as any;
    return new PodGoalService({
      store,
      pods,
      startGoal,
      resolveProjectDir: () => projectDir,
      now: () => '2026-10-29T00:00:00.000Z',
      newId: () => `pg_${Math.random().toString(36).slice(2, 8)}`,
      notify: (podId) => notifications.push(podId),
      budget,
      ...extra,
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-goals-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    projectDir = path.join(dir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    startGoal = jest.fn(async () => {});
    notifications = [];
    service = makeService();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('starts the first goal, queues the second, and promotes on archive', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    const second = await service.enqueueGoal('g2', projectDir);

    expect(first.status).toBe('started');
    expect(second.status).toBe('queued');
    expect(startGoal).toHaveBeenCalledTimes(1);
    expect(startGoal).toHaveBeenCalledWith('g1', projectDir);

    const duplicate = await service.enqueueGoal('g2', projectDir);
    expect(duplicate.status).toBe('queued');
    expect(startGoal).toHaveBeenCalledTimes(1);

    await service.onGoalArchived('g1');
    expect(store.getGoalByGoalId('g1')?.status).toBe('done');
    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g2');
    expect(startGoal).toHaveBeenCalledTimes(2);
    expect(startGoal).toHaveBeenLastCalledWith('g2', projectDir);
  });

  test('paused pod queues without starting and does not promote', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    store.updatePod(first.podId, { status: 'paused' }, '2026-10-29T00:00:00.000Z');

    const second = await service.enqueueGoal('g2', projectDir);
    expect(second.status).toBe('queued');
    expect(startGoal).toHaveBeenCalledTimes(1);

    await service.onGoalArchived('g1');
    expect(startGoal).toHaveBeenCalledTimes(1);
    expect(store.getActiveGoal(first.podId)).toBeNull();
    expect(store.getGoalByGoalId('g2')?.status).toBe('queued');
  });

  test('budget gate promotes the oldest queued goal when budget opens', async () => {
    let ok = false;
    service = makeService({
      canStart: () => ({ ok, spentUsd: ok ? 0 : 10, limitUsd: 5 }),
    });

    const blocked = await service.enqueueGoal('g1', projectDir);
    expect(blocked.status).toBe('queued');
    expect(startGoal).not.toHaveBeenCalled();

    ok = true;
    const promoted = await service.enqueueGoal('g2', projectDir);
    expect(promoted.status).toBe('queued');
    expect(startGoal).toHaveBeenCalledWith('g1', projectDir);
  });

  test('notifies on enqueue and archive', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    expect(notifications).toContain(first.podId);
    await service.onGoalArchived('g1');
    expect(notifications.filter((id) => id === first.podId).length).toBeGreaterThanOrEqual(2);
  });

  test('duplicate archive does not clobber the promoted active goal', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    await service.enqueueGoal('g2', projectDir);
    await service.enqueueGoal('g3', projectDir);

    await service.onGoalArchived('g1');
    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g2');
    await service.onGoalArchived('g1');

    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g2');
    expect(store.getGoalByGoalId('g3')?.status).toBe('queued');
    expect(startGoal).toHaveBeenCalledTimes(2);
  });

  test('cancelling a queued goal leaves the active goal untouched', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    await service.enqueueGoal('g2', projectDir);

    await service.onGoalArchived('g2', { verdict: 'CANCELLED' });

    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g1');
    expect(store.getGoalByGoalId('g2')?.status).toBe('aborted');
    expect(startGoal).toHaveBeenCalledTimes(1);
  });

  test('failed start rolls the active slot back to queued', async () => {
    startGoal.mockRejectedValueOnce(new Error('boom'));

    await expect(service.enqueueGoal('g1', projectDir)).rejects.toThrow('boom');

    const pod = store.getPodByProject(path.resolve(projectDir))!;
    expect(store.getGoalByGoalId('g1')?.status).toBe('queued');
    expect(store.getActiveGoal(pod.id)).toBeNull();
  });

  test('promote starts a queued goal after wake', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    store.updatePod(first.podId, { status: 'paused' }, '2026-10-29T00:00:00.000Z');
    const second = await service.enqueueGoal('g2', projectDir);
    expect(second.status).toBe('queued');
    await service.onGoalArchived('g1');
    expect(store.getActiveGoal(first.podId)).toBeNull();

    store.updatePod(first.podId, { status: 'idle' }, '2026-10-29T00:00:00.000Z');
    expect(await service.promote(first.podId)).toBe(true);
    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g2');
    expect(startGoal).toHaveBeenLastCalledWith('g2', path.resolve(projectDir));
  });

  test('re-enqueueing a budget-blocked goal starts it once budget opens', async () => {
    let ok = false;
    service = makeService({ canStart: () => ({ ok, spentUsd: 10, limitUsd: 5 }) });
    const first = await service.enqueueGoal('g1', projectDir);
    expect(first.status).toBe('queued');
    expect(startGoal).not.toHaveBeenCalled();

    ok = true;
    const again = await service.enqueueGoal('g1', projectDir);
    expect(again.status).toBe('started');
    expect(startGoal).toHaveBeenCalledWith('g1', path.resolve(projectDir));
  });

  test('reconcile archives a terminal active goal and promotes the next', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    await service.enqueueGoal('g2', projectDir);
    service = makeService(undefined, {
      goalState: (goalId) => ({ terminal: goalId === 'g1' }),
    });

    await service.reconcile();

    expect(store.getGoalByGoalId('g1')?.status).toBe('done');
    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g2');
    expect(startGoal).toHaveBeenLastCalledWith('g2', path.resolve(projectDir));
  });

  test('reconcile adopts an in-flight pre-feature goal without starting it again', async () => {
    const pod = store.ensurePod({
      id: 'pod_1',
      projectDir: path.resolve(projectDir),
      name: 'Project',
      now: '2026-10-29T00:00:00.000Z',
    });
    service = makeService(undefined, {
      listInFlightGoals: () => ['g0'],
      goalState: () => ({ terminal: false }),
    });

    await service.reconcile();

    expect(store.getActiveGoal(pod.id)?.goalId).toBe('g0');
    expect(store.getPod(pod.id)?.activeGoalId).toBe('g0');
    expect(startGoal).not.toHaveBeenCalled();
  });

  test('reconcile repairs a missing activeGoalId pointer', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    store.updatePod(first.podId, { activeGoalId: null }, '2026-10-29T00:00:00.000Z');

    await service.reconcile();

    expect(store.getPod(first.podId)?.activeGoalId).toBe('g1');
    expect(store.getActiveGoal(first.podId)?.goalId).toBe('g1');
    expect(startGoal).toHaveBeenCalledTimes(1);
  });

  test('archiving a goal preserves an archived pod status', async () => {
    const first = await service.enqueueGoal('g1', projectDir);
    store.updatePod(first.podId, { status: 'archived' }, '2026-10-29T00:00:00.000Z');

    await service.onGoalArchived('g1');

    expect(store.getPod(first.podId)?.status).toBe('archived');
  });
});
