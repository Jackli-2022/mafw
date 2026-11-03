import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodSessionLifecycle } from '../../../src/core/pod/pod-session-lifecycle';
import { PodSessionSupervisor } from '../../../src/core/pod/pod-session-supervisor';
import { PodStore, type PodGoalRevisionStatus } from '../../../src/core/pod/pod-store';

const NOW = '2026-11-03T00:00:00.000Z';

describe('PodSessionLifecycle', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let supervisor: PodSessionSupervisor;
  let snapshots: string[];
  let snapshotFails: boolean;
  let seq: number;

  const now = () => NOW;
  const newId = () => `id_${++seq}`;

  function seedPod() {
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    store.upsertMember({
      id: 'm_tech',
      podId: 'pod_1',
      role: 'tech_lead',
      displayName: 'Tech Lead',
      agentName: 'mafw-tech-lead',
      modelProvider: null,
      modelId: null,
      status: 'available',
      configJson: null,
      now: NOW,
    });
  }

  function seedRevision(revision: number, status: PodGoalRevisionStatus, active = false) {
    store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'g1',
      revision,
      status,
      now: NOW,
    });
    if (active) store.setActiveRevision('pod_1', 'g1', revision);
  }

  function lease(goalId: string, revision: number, sessionId: string) {
    store.leaseScopedSession({
      id: `lease_${sessionId}`,
      scope: {
        podId: 'pod_1',
        memberId: 'm_tech',
        goalId,
        revision,
        kind: 'discussion',
      },
      sessionId,
      now: NOW,
    });
  }

  function lifecycle() {
    return new PodSessionLifecycle({
      store,
      supervisor,
      snapshotSession: async (sessionId) => {
        if (snapshotFails) throw new Error('snapshot failed');
        snapshots.push(sessionId);
      },
      log: () => {},
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-session-life-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    seq = 0;
    snapshots = [];
    snapshotFails = false;
    supervisor = new PodSessionSupervisor({ store, now, newId });
    seedPod();
    store.enqueueGoal({ id: 'pg1', podId: 'pod_1', goalId: 'g1', now: NOW });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('retireRevision snapshots and ends only the target revision lease', async () => {
    seedRevision(1, 'completed');
    seedRevision(2, 'discussing', true);
    lease('g1', 1, 'ses_rev1');
    lease('g1', 2, 'ses_rev2');

    const retired = await lifecycle().retireRevision('g1', 1);

    expect(retired).toBe(true);
    expect(snapshots).toEqual(['ses_rev1']);
    expect(store.getSessionBySessionId('ses_rev1')?.endedAt).toBeTruthy();
    expect(store.getSessionBySessionId('ses_rev2')?.endedAt).toBeNull();
  });

  test('snapshot failure still retires the lease', async () => {
    seedRevision(1, 'completed');
    seedRevision(2, 'discussing', true);
    lease('g1', 1, 'ses_rev1');
    snapshotFails = true;

    await lifecycle().retireRevision('g1', 1);

    expect(store.getSessionBySessionId('ses_rev1')?.endedAt).toBeTruthy();
  });

  test('stale sweep retires old and terminal revisions but keeps current active', async () => {
    seedRevision(1, 'completed');
    seedRevision(2, 'discussing', true);
    seedRevision(3, 'aborted');
    lease('g1', 1, 'ses_rev1');
    lease('g1', 2, 'ses_rev2');
    lease('g1', 3, 'ses_rev3');

    const retired = await lifecycle().retireStaleDiscussionLeases();

    expect(retired).toBe(2);
    expect(store.getSessionBySessionId('ses_rev1')?.endedAt).toBeTruthy();
    expect(store.getSessionBySessionId('ses_rev2')?.endedAt).toBeNull();
    expect(store.getSessionBySessionId('ses_rev3')?.endedAt).toBeTruthy();
  });

  test('missing goal/revision lease is retired', async () => {
    lease('missing-goal', 1, 'ses_orphan');

    const retired = await lifecycle().retireStaleDiscussionLeases();

    expect(retired).toBe(1);
    expect(store.getSessionBySessionId('ses_orphan')?.endedAt).toBeTruthy();
  });
});
