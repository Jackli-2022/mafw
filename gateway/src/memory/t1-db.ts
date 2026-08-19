// T1 observation store backed by SQLite (replaces spiral-*.jsonl files).
// Single writer: the gateway process. The opencode-side plugin sends
// observations via POST /api/obs/capture; the gateway assigns turn IDs
// (database-driven, so serve/plugin restarts cannot renumber turns).
//
// Dedup is database-level (UNIQUE on session/turn/source/content), which
// survives process restarts — unlike an in-memory hash window.
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

export type ObservationSource = 'user_input' | 'assistant_reply' | 'tool_result' | 'reasoning';

export interface T1Observation {
  id: number;
  session_id: string;
  turn_id: number;
  source: ObservationSource;
  content: string;
  failure: number;
  created_at: number;
}

export interface TurnSummary {
  session_id: string;
  turn_id: number;
  count: number;
  has_user_input: number;
  response_count: number;
  last_ts: number;
}

export class T1Database {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS t1_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        failure INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(session_id, turn_id, source, content)
      );
      CREATE INDEX IF NOT EXISTS idx_t1_session ON t1_observations(session_id, turn_id);
    `);
  }

  /**
   * Next turn ID for a new user message: max existing turn for the session + 1.
   * No rows yet → 1.
   */
  nextTurnId(session_id: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(turn_id), 0) AS m FROM t1_observations WHERE session_id = ?')
      .get(session_id) as { m: number };
    return row.m + 1;
  }

  /** Current turn ID for non-user observations: max existing turn, or 0. */
  currentTurnId(session_id: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(turn_id), 0) AS m FROM t1_observations WHERE session_id = ?')
      .get(session_id) as { m: number };
    return row.m;
  }

  /**
   * Insert one observation. Database-level dedup via the UNIQUE constraint:
   * a duplicate (same session/turn/source/content) is silently ignored.
   * Returns the row id, or null when deduplicated.
   */
  append(obs: Omit<T1Observation, 'id' | 'created_at'>): number | null {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO t1_observations (session_id, turn_id, source, content, failure)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(obs.session_id, obs.turn_id, obs.source, obs.content, obs.failure);
    return result.changes > 0 ? Number(result.lastInsertRowid) : null;
  }

  /** Per-session turn summaries (grouped), optionally filtered to a session. */
  listTurns(session_id?: string): TurnSummary[] {
    const where = session_id ? 'WHERE session_id = ?' : '';
    const rows = this.db
      .prepare(
        `SELECT session_id, turn_id,
                COUNT(*) AS count,
                MAX(CASE WHEN source = 'user_input' THEN 1 ELSE 0 END) AS has_user_input,
                SUM(CASE WHEN source IN ('assistant_reply','tool_result','reasoning') AND length(trim(content)) > 0 THEN 1 ELSE 0 END) AS response_count,
                MAX(created_at) AS last_ts
         FROM t1_observations
         ${where}
         GROUP BY session_id, turn_id
         ORDER BY session_id, turn_id`,
      )
      .all(...(session_id ? [session_id] : [])) as TurnSummary[];
    return rows;
  }

  readTurn(session_id: string, turn_id: number): T1Observation[] {
    return this.db
      .prepare('SELECT * FROM t1_observations WHERE session_id = ? AND turn_id = ? ORDER BY id')
      .all(session_id, turn_id) as T1Observation[];
  }

  /** Remove all observations for a session up to (and including) a turn. */
  deleteTurn(session_id: string, turn_id: number): number {
    const result = this.db
      .prepare('DELETE FROM t1_observations WHERE session_id = ? AND turn_id = ?')
      .run(session_id, turn_id);
    return result.changes;
  }

  deleteSession(session_id: string): number {
    return this.db.prepare('DELETE FROM t1_observations WHERE session_id = ?').run(session_id).changes;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM t1_observations').get() as { c: number }).c;
  }

  close(): void {
    this.db.close();
  }
}
