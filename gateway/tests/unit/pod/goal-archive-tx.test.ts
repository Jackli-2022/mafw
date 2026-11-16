import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore, type PodRow } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';
import type { PodDetail } from '../../../src/core/pod/pod-service';

const NOW = '2026-11-16T00:00:00.000Z';

function detailFor(store: PodStore, pod: PodRow): PodDetail {
  return {
    pod,
    members: store.listMembers(pod.id),
    goals: store.listGoals(pod.id),
    tasks: store.listTasks(pod.id),
    sessions: store.listSessions(pod.id),
  } as PodDetail;
}

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-archive-tx-'));
  const db = new Database(':memory:');
  const store = new PodStore(db);
  const projectDir = path.join(dir, 'project');
  fs.mkdirSync(projectDir, { recursive: true });
  const service = new PodGoalService({
    store,
    pods: {
      ensure: async (requested: string) => {
        const canonical = path.resolve(requested);
        const pod = store.getPodByProject(canonical) ?? store.ensurePod({
          id: 'pod_1', projectDir: canonical, name: 'Project', now: NOW,
        });
        return detailFor(store, pod);
      },
    } as any,
    startGoal: async () => {},
    advanceGoal: async () => {},
    resolveProjectDir: () => projectDir,
    now: () => NOW,
    newId: () => `pg_${Math.random().toString(36).slice(2, 8)}`,
    notify: () => {},
  });
  await service.enqueueGoal('g1', projectDir);
  expect(store.getGoalByGoalId('g1')?.status).toBe('active');
  return { dir, db, store, service };
}

test('rolls back the archive when the in-transaction writer throws', async () => {
  const h = await harness();
  try {
    await expect(
      h.service.onGoalArchived('g1', { verdict: 'FAIL' }, {
        inTransaction: () => { throw new Error('domain append failed'); },
      }),
    ).rejects.toThrow('domain append failed');
    expect(h.store.getGoalByGoalId('g1')?.status).toBe('active');
  } finally {
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('runs the in-transaction writer before committing the archive', async () => {
  const h = await harness();
  try {
    const seen: string[] = [];
    await h.service.onGoalArchived('g1', { verdict: 'PASS' }, {
      inTransaction: (goal) => { seen.push(goal.goalId); },
    });
    expect(seen).toEqual(['g1']);
    expect(h.store.getGoalByGoalId('g1')?.status).toBe('done');
  } finally {
    h.db.close();
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});
