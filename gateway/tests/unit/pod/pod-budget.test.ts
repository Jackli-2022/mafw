import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodBudget } from '../../../src/core/pod/pod-budget';

describe('PodBudget', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-budget-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: '/proj', name: 'P', now: new Date().toISOString() });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function budget(limit: number, cost = 3) {
    return new PodBudget({
      store,
      costForSessions: (ids) => ids.length * cost,
      dailyUsd: () => limit,
      nowEpoch: () => Math.floor(Date.now() / 1000),
    });
  }

  test('cost is zero when the pod has no sessions', () => {
    expect(budget(10).cost('pod_1')).toEqual({ spentUsd: 0, limitUsd: 10 });
  });

  test('sums only the pod session ids and applies the daily limit', () => {
    for (const sessionId of ['s1', 's2']) {
      store.insertSession({
        id: `ps_${sessionId}`, podId: 'pod_1', memberId: 'm1', goalId: 'g1', node: 'execute',
        sessionId, status: 'active', transcriptRef: null, now: new Date().toISOString(),
      });
    }

    expect(budget(10).cost('pod_1')).toEqual({ spentUsd: 6, limitUsd: 10 });
    expect(budget(10).canStart('pod_1').ok).toBe(true);
    expect(budget(5).canStart('pod_1').ok).toBe(false);
    expect(budget(0).canStart('pod_1').ok).toBe(true);
  });
});
