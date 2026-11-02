import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

const STARTED = '2026-11-02T00:00:00.000Z';

describe('goal_node_runs revision', () => {
  let dir: string;
  let dbPath: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-node-runs-revision-'));
    dbPath = path.join(dir, 'gateway.db');
    db = new GatewayDatabase(dbPath);
  });

  afterEach(() => {
    try {
      db.getStore().close();
    } catch {
      // already closed by an individual test
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const insertRun = (init: { revision?: number; loop?: number } = {}): number =>
    db.insertNodeRun({
      goalId: 'g1',
      projectId: '/proj/a',
      loop: init.loop ?? 1,
      revision: init.revision,
      node: 'plan',
      attempt: 1,
      sessionId: null,
      startedAt: STARTED,
    });

  test('records the revision and scopes latestNodeAttempt by it', () => {
    const rev1 = insertRun({ revision: 1 });
    const rev2 = insertRun({ revision: 2 });

    expect(db.listNodeRuns('g1').map((row) => row.revision)).toEqual([1, 2]);
    expect(db.latestNodeAttempt('g1', 2, 1, 'plan')?.id).toBe(rev2);
    expect(db.latestNodeAttempt('g1', 1, 1, 'plan')?.id).toBe(rev1);
    expect(db.latestNodeAttempt('g1', 3, 1, 'plan')).toBeNull();
  });

  test('defaults a missing revision to 1', () => {
    const runId = insertRun();

    expect(db.listNodeRuns('g1')[0].revision).toBe(1);
    expect(db.latestNodeAttempt('g1', 1, 1, 'plan')?.id).toBe(runId);
  });

  test('the removed three-argument arity fails loudly instead of pinning revision 1 (I-1)', () => {
    insertRun({ revision: 2 });

    // 旧调用方 (goalId, loop, node) 曾静默按 revision 1 查找——现在必须报错。
    expect(() => (db as any).latestNodeAttempt('g1', 1, 'plan'))
      .toThrow(/latestNodeAttempt requires \(goalId, revision, loop, node\)/);
    // revision 显式传入才拿得到 revision 2 的行。
    expect(db.listNodeRuns('g1')).toHaveLength(1);
    expect(db.latestNodeAttempt('g1', 2, 1, 'plan')?.revision).toBe(2);
  });

  test('rows written without a revision value read back as revision 1', () => {
    db.getStore().prepare(`
      INSERT INTO goal_node_runs (goal_id, project_id, loop, node, attempt, status, started_at)
      VALUES ('g_legacy', '/proj/a', 1, 'execute', 1, 'done', ?)
    `).run(STARTED);

    const rows = db.listNodeRuns('g_legacy');
    expect(rows).toHaveLength(1);
    expect(rows[0].revision).toBe(1);
    expect(db.latestNodeAttempt('g_legacy', 1, 1, 'execute')?.revision).toBe(1);
  });

  test('a legacy goal_node_runs table gains the revision column with default 1', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-node-runs-legacy-'));
    const legacyPath = path.join(legacyDir, 'gateway.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE goal_node_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        goal_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        loop INTEGER NOT NULL,
        node TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        session_id TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT,
        error TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        cost_usd REAL
      );
    `);
    legacy.prepare(
      "INSERT INTO goal_node_runs (goal_id, project_id, loop, node, status, started_at) VALUES ('g_old', '/proj/a', 1, 'review', 'succeeded', ?)",
    ).run(STARTED);
    legacy.close();

    const migrated = new GatewayDatabase(legacyPath);
    expect(migrated.listNodeRuns('g_old').map((row) => row.revision)).toEqual([1]);
    expect(migrated.latestNodeAttempt('g_old', 1, 1, 'review')?.status).toBe('succeeded');
    migrated.getStore().close();

    fs.rmSync(legacyDir, { recursive: true, force: true });
  });
});
