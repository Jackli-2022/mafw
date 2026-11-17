import Database from 'better-sqlite3';
import { PodStore } from '../../src/core/pod/pod-store';

const now = '2026-11-17T00:00:00.000Z';

function legacyDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE pod_goal_review_items (
      id TEXT PRIMARY KEY,
      pod_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      rel TEXT NOT NULL,
      start_line INTEGER,
      end_line INTEGER,
      code TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL,
      anchor_json TEXT,
      response TEXT,
      origin_item_id TEXT,
      origin_revision INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      responded_at TEXT,
      resolved_at TEXT
    );
  `);
  return db;
}

function activeStore(): { db: Database.Database; store: PodStore } {
  const db = new Database(':memory:');
  const store = new PodStore(db);
  store.enqueueGoal({ id: 'row_1', podId: 'pod_1', goalId: 'g1', now });
  store.setGoalStatus('row_1', 'active', { startedAt: now });
  return { db, store };
}

describe('PodStore review provenance', () => {
  test('stores source/clientRef, finds retries, and carries provenance', () => {
    const { store } = activeStore();
    const source = {
      kind: 'project' as const,
      projectDir: 'C:/repo',
      root: 'C:/repo',
      contentVersion: 'v1',
    };
    const item = store.createReviewItem({
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      rel: 'src/a.ts',
      comment: '改这里',
      sourceJson: JSON.stringify(source),
      clientRef: 'ann-1',
      now,
    });

    expect(item.source).toEqual(source);
    expect(item.clientRef).toBe('ann-1');
    expect(store.findReviewItemByClientRef('pod_1', 'g1', 1, 'ann-1')?.id).toBe(item.id);

    store.carryForwardReviewItems({
      podId: 'pod_1',
      goalId: 'g1',
      fromRevision: 1,
      toRevision: 2,
      now,
    });
    const carried = store.listReviewItems('pod_1', 'g1', 2)[0];
    expect(carried.source).toEqual(source);
    expect(carried.clientRef).toBe('ann-1');
  });

  test('migrates the legacy review table and rejects duplicate client refs per revision', () => {
    const db = legacyDb();
    const store = new PodStore(db);
    const columns = (db.prepare('PRAGMA table_info(pod_goal_review_items)').all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['source_json', 'client_ref']));

    store.enqueueGoal({ id: 'row_1', podId: 'pod_1', goalId: 'g1', now });
    store.setGoalStatus('row_1', 'active', { startedAt: now });
    const base = { podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/a.ts', comment: 'x', clientRef: 'same', now };
    store.createReviewItem({ ...base, sourceJson: null });
    expect(() => store.createReviewItem({ ...base, sourceJson: null })).toThrow();
    expect(store.findReviewItemByClientRef('pod_1', 'g1', 1, 'same')).not.toBeNull();
  });

  test('invalid legacy source JSON is exposed as null', () => {
    const db = legacyDb();
    const store = new PodStore(db);
    db.prepare(`
      INSERT INTO pod_goal_review_items (
        id, pod_id, goal_id, revision, status, rel, comment, source_json, created_at, updated_at
      ) VALUES ('review_bad', 'pod_1', 'g1', 1, 'pending', 'a.ts', 'x', '{broken', ?, ?)
    `).run(now, now);
    expect(store.getReviewItem('review_bad')?.source).toBeNull();
  });

  test('structurally invalid source JSON is exposed as null', () => {
    const db = legacyDb();
    const store = new PodStore(db);
    const insert = db.prepare(`
      INSERT INTO pod_goal_review_items (
        id, pod_id, goal_id, revision, status, rel, comment, source_json, created_at, updated_at
      ) VALUES (?, 'pod_1', 'g1', 1, 'pending', 'a.ts', 'x', ?, ?, ?)
    `);
    const cases: Array<[string, string]> = [
      ['review_missing_project', JSON.stringify({ kind: 'project', root: 'C:/r' })],
      ['review_bad_version', JSON.stringify({
        kind: 'project', projectDir: 'C:/r', root: 'C:/r', contentVersion: 5,
      })],
      ['review_goal_no_rev', JSON.stringify({
        kind: 'goal', projectDir: 'C:/r', root: 'C:/r', goalId: 'g1',
      })],
      ['review_bad_kind', JSON.stringify({ kind: 'other', projectDir: 'C:/r', root: 'C:/r' })],
      ['review_non_object', JSON.stringify('C:/r')],
    ];
    for (const [id, json] of cases) insert.run(id, json, now, now);
    for (const [id] of cases) {
      expect(store.getReviewItem(id)?.source).toBeNull();
    }

    const valid = {
      kind: 'goal', projectDir: 'C:/r', goalId: 'g1', revision: 2,
      root: 'C:/r', contentVersion: null,
    };
    insert.run('review_valid', JSON.stringify(valid), now, now);
    expect(store.getReviewItem('review_valid')?.source).toEqual(valid);
  });
});
