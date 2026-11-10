import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { GatewayDatabase } from '../../src/memory/gateway-db';

function makeLegacyDb(file: string): void {
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE t1_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      failure INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(session_id, turn_id, source, content)
    );
    CREATE TABLE t1_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      failure INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      archived_at INTEGER DEFAULT (unixepoch())
    );
  `);
  raw.prepare(`INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
               VALUES (?,?,?,?,?,?)`).run('s1', 1, 'user_input', 'first', 0, 1);
  raw.prepare(`INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
               VALUES (?,?,?,?,?,?)`).run('s1', 1, 'user_input', 'second', 0, 2);
  raw.prepare(`INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
               VALUES (?,?,?,?,?,?)`).run('s1', 1, 'assistant_reply', 'answer', 0, 3);
  raw.prepare(`INSERT INTO t1_observations (session_id, turn_id, source, content, failure)
               VALUES (?,?,?,?,?)`).run('s1', 1, 'user_input', 'third live epoch', 0);
  raw.close();
}

describe('T1 legacy identity migration', () => {
  test('marks duplicate legacy turns and links every row without merging content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-legacy-'));
    const file = path.join(dir, 'legacy.db');
    makeLegacyDb(file);

    const db = new GatewayDatabase(file);
    const turn = db.currentTurn('s1');
    expect(turn?.legacy_ambiguous).toBe(1);
    expect(turn?.trace_id).toMatch(/^t1l_/);
    const active = db.readTurn('s1', 1);
    const archived = db.readArchiveTurn('s1', 1);
    expect(active[0].trace_id).toBe(turn?.trace_id);
    expect(archived.every((r) => r.trace_id === turn?.trace_id)).toBe(true);
    expect(active[0].observation_key).not.toBe(archived[0].observation_key);
    expect(db.nextTurnId('s1')).toBe(2);
    expect(db.beginTurn('s1').turn_seq).toBe(2);

    db.close();
    const reopened = new GatewayDatabase(file);
    // Reopening must be idempotent: the legacy composite still maps to exactly
    // one ambiguous `t1l_` turn (repeated migration never duplicates it even
    // though `beginTurn` above has already advanced `currentTurn` to turn_seq=2),
    // and that advancement persists so the next sequence is 3.
    const legacyTurns = reopened
      .getStore()
      .prepare(`SELECT legacy_ambiguous FROM t1_turns WHERE session_id = ? AND trace_id LIKE 't1l_%'`)
      .all('s1') as Array<{ legacy_ambiguous: number }>;
    expect(legacyTurns).toHaveLength(1);
    expect(legacyTurns[0].legacy_ambiguous).toBe(1);
    expect(reopened.nextTurnId('s1')).toBe(3);
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
