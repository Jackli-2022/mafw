import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';
import type { PodDetail } from '../../../src/core/pod/pod-service';

const NOW = '2026-11-03T00:00:00.000Z';

describe('PodGoalService discussion start gate', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let projectDir: string;
  let startGoal: jest.Mock;
  let advanceGoal: jest.Mock;
  let service: PodGoalService;

  const detailFor = (pod: any): PodDetail => ({
    pod,
    members: store.listMembers(pod.id),
    goals: store.listGoals(pod.id),
    tasks: store.listTasks(pod.id),
    sessions: store.listSessions(pod.id),
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-goal-gate-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    projectDir = path.join(dir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });
    store.ensurePod({ id: 'pod_1', projectDir, name: 'P', now: NOW });
    startGoal = jest.fn(async () => undefined);
    advanceGoal = jest.fn(async () => undefined);
    service = new PodGoalService({
      store,
      pods: { ensure: jest.fn(async () => detailFor(store.getPod('pod_1'))) } as any,
      startGoal,
      advanceGoal,
      resolveProjectDir: () => projectDir,
      now: () => NOW,
      newId: () => `pg_${Math.random().toString(36).slice(2, 8)}`,
      notify: () => undefined,
      log: () => undefined,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedGoal(status: 'active' | 'queued'): string {
    store.enqueueGoal({ id: 'pg_g1', podId: 'pod_1', goalId: 'g1', now: NOW });
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'discussing', now: NOW,
    });
    store.setGoalStatus('pg_g1', status, { startedAt: status === 'active' ? NOW : undefined });
    if (status === 'active') {
      store.updatePod('pod_1', { status: 'active', activeGoalId: 'g1' }, NOW);
    }
    return 'g1';
  }

  test('resume never advances an active discussing Goal; it advances once planning begins', async () => {
    seedGoal('active');
    store.updatePod('pod_1', { status: 'paused' }, NOW);

    await service.resume('pod_1');
    expect(advanceGoal).not.toHaveBeenCalled();
    expect(startGoal).not.toHaveBeenCalled();
    expect(store.getGoal('pod_1', 'g1')?.status).toBe('active');

    store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'planning', now: NOW,
    });
    await service.resume('pod_1');
    expect(advanceGoal).toHaveBeenCalledWith('g1');
    expect(startGoal).not.toHaveBeenCalled();
  });

  test('resume never promotes a queued discussing Goal; planning unlocks it', async () => {
    seedGoal('queued');
    store.updatePod('pod_1', { status: 'paused' }, NOW);

    await service.resume('pod_1');
    expect(startGoal).not.toHaveBeenCalled();
    expect(store.getGoal('pod_1', 'g1')?.status).toBe('queued');

    store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'planning', now: NOW,
    });
    await service.resume('pod_1');
    expect(startGoal).toHaveBeenCalledWith('g1', projectDir);
    expect(store.getGoal('pod_1', 'g1')?.status).toBe('active');
  });

  test('direction_review and terminal revisions are not startable', () => {
    seedGoal('queued');
    expect(service.isStartable('g1')).toBe(false);

    store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'direction_review',
      directionStatus: 'pending', now: NOW,
    });
    expect(service.isStartable('g1')).toBe(false);

    store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed', now: NOW,
    });
    expect(service.isStartable('g1')).toBe(false);
  });

  test('enqueueGoal reports queued when startQueued refuses a discussing Goal', async () => {
    // Revision exists before the root row (direct Goal intake creates both).
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g-discuss', revision: 1, status: 'discussing', now: NOW,
    });

    const result = await service.enqueueGoal('g-discuss', projectDir);

    expect(result.status).toBe('queued');
    expect(startGoal).not.toHaveBeenCalled();
    expect(store.getGoal('pod_1', 'g-discuss')?.status).toBe('queued');
    expect(store.getActiveGoal('pod_1')).toBeNull();
  });

  test('legacy Goals without a revision row remain startable', () => {
    store.enqueueGoal({ id: 'pg_legacy', podId: 'pod_1', goalId: 'legacy', now: NOW });
    expect(service.isStartable('legacy')).toBe(true);
  });
});
