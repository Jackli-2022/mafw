import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:10:00.000Z';

describe('PodStore goal revisions', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;

  const seedGoal = (): void => {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    store.enqueueGoal({ id: 'pg_1', podId: 'pod_1', goalId: 'g1', now: NOW });
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-revisions-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('appends revisions without moving the active revision', () => {
    seedGoal();

    const rev1 = store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'discussing',
      priority: 0,
      now: NOW,
    });
    const rev2 = store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 2,
      status: 'queued',
      priority: 10,
      now: LATER,
    });

    expect(store.listGoalRevisions('pod_1', 'g1').map((row) => row.revision)).toEqual([1, 2]);
    expect(store.listQueuedGoalRevisions('pod_1')[0].revision).toBe(2);
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(1);

    expect(rev1).toMatchObject({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'discussing',
      verdict: null,
      directionStatus: 'none',
      directionJson: null,
      planHash: null,
      evalHash: null,
      feedback: null,
      priority: 0,
      enqueuedAt: NOW,
      startedAt: null,
      endedAt: null,
    });
    expect(rev2.id).not.toBe(rev1.id);
    expect(rev2.priority).toBe(10);
    expect(rev2.enqueuedAt).toBe(LATER);
  });

  test('createGoalRevision is append-only for an existing revision number', () => {
    seedGoal();
    const first = store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'discussing', now: NOW,
    });
    const again = store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'planning', now: LATER,
    });

    expect(again.id).toBe(first.id);
    expect(again.status).toBe('discussing');
    expect(store.listGoalRevisions('pod_1', 'g1')).toHaveLength(1);
  });

  test('queued revisions are ordered by priority then enqueue time', () => {
    seedGoal();
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 1, status: 'queued', priority: 0, now: NOW });
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 3, status: 'queued', priority: 5, now: LATER });
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 2, status: 'implementing', priority: 99, now: LATER });

    expect(store.listQueuedGoalRevisions('pod_1').map((row) => row.revision)).toEqual([3, 1]);
    expect(store.listQueuedGoalRevisions('pod_other')).toEqual([]);
  });

  test('setGoalRevisionStatus patches status and stamps lifecycle timestamps', () => {
    seedGoal();
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 1, status: 'queued', now: NOW });

    store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'implementing', now: LATER,
    });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'implementing',
      startedAt: LATER,
      endedAt: null,
    });

    store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed',
      now: '2026-11-02T00:20:00.000Z', verdict: 'PASS',
    });
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'completed',
      startedAt: LATER,
      endedAt: '2026-11-02T00:20:00.000Z',
      verdict: 'PASS',
    });
  });

  test('setGoalRevisionStatus records direction, plan/eval hashes and feedback', () => {
    seedGoal();
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 1, status: 'planning', now: NOW });

    store.setGoalRevisionStatus({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      status: 'plan_review',
      now: LATER,
      directionStatus: 'decided',
      directionJson: '{"optionId":"A"}',
      planHash: 'plan-hash',
      evalHash: 'eval-hash',
      feedback: 'tighten scope',
    });

    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({
      status: 'plan_review',
      directionStatus: 'decided',
      directionJson: '{"optionId":"A"}',
      planHash: 'plan-hash',
      evalHash: 'eval-hash',
      feedback: 'tighten scope',
    });
  });

  test('setActiveRevision points the goal root at the newest revision', () => {
    seedGoal();
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed', now: NOW, verdict: 'PASS' });
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 2, status: 'discussing', now: LATER });

    store.setActiveRevision('pod_1', 'g1', 2);
    expect(store.getGoal('pod_1', 'g1')?.activeRevision).toBe(2);
    // 旧 revision 保留真实 verdict（append-only，不反归档）
    expect(store.getGoalRevision('pod_1', 'g1', 1)).toMatchObject({ status: 'completed', verdict: 'PASS' });
  });

  test('nextGoalRevision continues from the highest revision or the active root', () => {
    seedGoal();
    expect(store.nextGoalRevision('pod_1', 'g1')).toBe(2);

    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 3, status: 'implementing', now: NOW });
    expect(store.nextGoalRevision('pod_1', 'g1')).toBe(4);

    store.setActiveRevision('pod_1', 'g1', 5);
    expect(store.nextGoalRevision('pod_1', 'g1')).toBe(6);
  });

  test('setGoalPriority updates the goal root', () => {
    seedGoal();
    expect(store.getGoal('pod_1', 'g1')?.priority).toBe(0);
    store.setGoalPriority('pod_1', 'g1', 7);
    expect(store.getGoal('pod_1', 'g1')?.priority).toBe(7);
  });

  test('legacy goals normalize to revision 1 with priority 0', () => {
    seedGoal();
    const goal = store.getGoal('pod_1', 'g1');
    expect(goal?.activeRevision).toBe(1);
    expect(goal?.priority).toBe(0);
    expect(store.listGoalRevisions('pod_1', 'g1')).toEqual([]);
  });

  test('a legacy pod_goals table is migrated in place and bootstrapped with its revision row', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-legacy-'));
    const legacyDb = new Database(path.join(legacyDir, 'legacy.db'));
    legacyDb.exec(`
      CREATE TABLE pod_goals (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        verdict TEXT,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        UNIQUE(pod_id, goal_id)
      );
    `);
    legacyDb.prepare(
      "INSERT INTO pod_goals (id, pod_id, goal_id, status, enqueued_at) VALUES ('pg_old', 'pod_1', 'g_old', 'done', ?)",
    ).run(NOW);

    const migrated = new PodStore(legacyDb);
    expect(migrated.getGoal('pod_1', 'g_old')).toMatchObject({
      id: 'pg_old',
      activeRevision: 1,
      priority: 0,
    });
    expect(migrated.listGoalRevisions('pod_1', 'g_old')).toEqual([
      expect.objectContaining({
        id: 'goalrev_g_old_1',
        podId: 'pod_1',
        goalId: 'g_old',
        revision: 1,
        status: 'completed',
        verdict: null,
        directionStatus: 'none',
        priority: 0,
        enqueuedAt: NOW,
        startedAt: null,
        endedAt: null,
      }),
    ]);

    legacyDb.close();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  });

  test('legacy bootstrap maps root status/verdict/priority/timestamps and is idempotent (I-3)', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-legacy-status-'));
    const legacyPath = path.join(legacyDir, 'legacy.db');
    const legacyDb = new Database(legacyPath);
    legacyDb.exec(`
      CREATE TABLE pod_goals (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        verdict TEXT,
        active_revision INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 0,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        UNIQUE(pod_id, goal_id)
      );
    `);
    const insert = legacyDb.prepare(`
      INSERT INTO pod_goals (id, pod_id, goal_id, status, verdict, active_revision, priority, enqueued_at, started_at, ended_at)
      VALUES (?, 'pod_1', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run('pg_a', 'g_active', 'active', null, 1, 3, NOW, LATER, null);
    insert.run('pg_q', 'g_queued', 'queued', null, 1, 0, NOW, null, null);
    insert.run('pg_d', 'g_done', 'done', 'PASS', 2, 1, NOW, LATER, '2026-11-02T00:30:00.000Z');
    insert.run('pg_x', 'g_aborted', 'aborted', 'CANCELLED', 1, 0, NOW, LATER, '2026-11-02T00:40:00.000Z');
    legacyDb.close();

    const firstDb = new Database(legacyPath);
    const migrated = new PodStore(firstDb);
    expect(migrated.getGoalRevision('pod_1', 'g_active', 1)).toMatchObject({
      status: 'implementing', priority: 3, startedAt: LATER,
    });
    expect(migrated.getGoalRevision('pod_1', 'g_queued', 1)).toMatchObject({
      status: 'queued', priority: 0, startedAt: null,
    });
    // 根指针在 revision 2 的历史 Goal：补的是 active_revision 那条，历史从 2 起；
    // 旧 revision 1 没有信息可还原，不伪造。
    expect(migrated.listGoalRevisions('pod_1', 'g_done').map((row) => row.revision)).toEqual([2]);
    expect(migrated.getGoalRevision('pod_1', 'g_done', 2)).toMatchObject({
      status: 'completed', verdict: 'PASS', endedAt: '2026-11-02T00:30:00.000Z',
    });
    expect(migrated.getGoalRevision('pod_1', 'g_aborted', 1)).toMatchObject({
      status: 'aborted', verdict: 'CANCELLED', endedAt: '2026-11-02T00:40:00.000Z',
    });
    firstDb.close();

    // 幂等：第二次打开同一个库不重复插入、也不改写已有 revision。
    const secondDb = new Database(legacyPath);
    const reopened = new PodStore(secondDb);
    expect(reopened.listGoalRevisions('pod_1', 'g_done')).toHaveLength(1);
    expect(reopened.listGoalRevisions('pod_1', 'g_active')).toHaveLength(1);
    expect(reopened.listGoalRevisions('pod_1', 'g_queued')).toHaveLength(1);
    expect(reopened.listGoalRevisions('pod_1', 'g_aborted')).toHaveLength(1);
    secondDb.close();

    fs.rmSync(legacyDir, { recursive: true, force: true });
  });

  test('goals created after initialization get no bootstrap row (intake owns revision 1)', () => {
    seedGoal();
    expect(store.listGoalRevisions('pod_1', 'g1')).toEqual([]);
    expect(store.nextGoalRevision('pod_1', 'g1')).toBe(2);
  });

  test('terminal revisions are immutable (I-2)', () => {
    seedGoal();
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'queued',
      priority: 0, now: NOW,
    });
    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'implementing', now: NOW,
    })).toBe(true);
    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed', now: LATER, verdict: 'PASS',
    })).toBe(true);

    const completed = store.getGoalRevision('pod_1', 'g1', 1);

    // 打回不能把已完成的 revision 改回 queued……
    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'queued', now: '2026-11-02T01:00:00.000Z',
    })).toBe(false);
    // ……也不能把它改判 FAIL。
    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed',
      now: '2026-11-02T01:00:00.000Z', verdict: 'FAIL',
    })).toBe(false);

    const after = store.getGoalRevision('pod_1', 'g1', 1);
    expect(after).toMatchObject({
      status: 'completed',
      verdict: 'PASS',
      startedAt: NOW,
      endedAt: LATER,
    });
    expect(after).toEqual(completed);
  });

  test('aborted and discarded revisions are immutable too (I-2)', () => {
    seedGoal();
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 1, status: 'aborted', now: NOW });
    store.createGoalRevision({ podId: 'pod_1', goalId: 'g1', revision: 2, status: 'discarded', now: NOW });

    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'implementing', now: LATER,
    })).toBe(false);
    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 2, status: 'queued', now: LATER,
    })).toBe(false);
    expect(store.getGoalRevision('pod_1', 'g1', 1)?.status).toBe('aborted');
    expect(store.getGoalRevision('pod_1', 'g1', 2)?.status).toBe('discarded');
  });

  test('setGoalRevisionStatus reports false for a revision that does not exist (I-2)', () => {
    seedGoal();
    expect(store.setGoalRevisionStatus({
      podId: 'pod_1', goalId: 'g1', revision: 9, status: 'planning', now: NOW,
    })).toBe(false);
    expect(store.listGoalRevisions('pod_1', 'g1')).toEqual([]);
  });
});
