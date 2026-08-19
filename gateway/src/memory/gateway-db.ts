// Gateway unified database (SQLite). Owns the T1 observation store (single
// writer = this gateway; the opencode-side plugin pushes observations via
// POST /api/obs/capture) plus a generic kv_store for small critical state
// (manager sessions, reflect cursor, registry snapshot) that must move with
// the data directory and never be lost to project-directory operations.
//
// Turn IDs are database-driven, so plugin/serve restarts can never renumber
// turns or duplicate writes (database-level UNIQUE dedup on observations).
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

export class GatewayDatabase {
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

      CREATE TABLE IF NOT EXISTS trajectory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        tool_name TEXT,
        call_id TEXT,
        tool_state TEXT,
        agent TEXT,
        model TEXT,
        input_summary TEXT,
        output_summary TEXT,
        error TEXT,
        tokens TEXT,
        cost REAL,
        finish TEXT,
        time_ms REAL NOT NULL,
        duration_ms REAL,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_traj_evt_session ON trajectory_events(session_id, turn_id, seq);
      CREATE INDEX IF NOT EXISTS idx_traj_evt_ttl ON trajectory_events(created_at);

      CREATE TABLE IF NOT EXISTS trajectory_turns (
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        turn_start_ms REAL NOT NULL,
        turn_end_ms REAL,
        duration_ms REAL,
        tool_count INTEGER DEFAULT 0,
        tool_error_count INTEGER DEFAULT 0,
        reasoning_count INTEGER DEFAULT 0,
        agent_switch_count INTEGER DEFAULT 0,
        tokens TEXT,
        cost REAL DEFAULT 0,
        finish TEXT,
        model TEXT,
        agent TEXT,
        user_text TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (session_id, turn_id)
      );
      CREATE INDEX IF NOT EXISTS idx_traj_turn_ttl ON trajectory_turns(created_at);

      CREATE TABLE IF NOT EXISTS anchor_units (
        anchor TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        weight REAL DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (anchor, unit_id)
      );
      CREATE INDEX IF NOT EXISTS idx_anchor_units_anchor ON anchor_units(anchor);
      CREATE INDEX IF NOT EXISTS idx_anchor_units_unit ON anchor_units(unit_id);

      CREATE TABLE IF NOT EXISTS anchor_edges (
        unit_a TEXT NOT NULL,
        unit_b TEXT NOT NULL,
        shared_anchors INTEGER NOT NULL,
        weight REAL NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (unit_a, unit_b)
      );
      CREATE INDEX IF NOT EXISTS idx_anchor_edges_a ON anchor_edges(unit_a);
      CREATE INDEX IF NOT EXISTS idx_anchor_edges_b ON anchor_edges(unit_b);

      CREATE TABLE IF NOT EXISTS kv_store (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (scope, key)
      );
    `);
  }

  // ── T1 observations ─────────────────────────────────────────────────────

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

  // ── KV store (small critical state) ─────────────────────────────────────

  kvGet<T = string>(scope: string, key: string): T | null {
    const row = this.db.prepare('SELECT value FROM kv_store WHERE scope = ? AND key = ?').get(scope, key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  kvSet(scope: string, key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO kv_store (scope, key, value) VALUES (?, ?, ?)
         ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
      )
      .run(scope, key, JSON.stringify(value));
  }

  kvDelete(scope: string, key: string): void {
    this.db.prepare('DELETE FROM kv_store WHERE scope = ? AND key = ?').run(scope, key);
  }

  kvAll<T = string>(scope: string): Array<{ key: string; value: T }> {
    const rows = this.db.prepare('SELECT key, value FROM kv_store WHERE scope = ? ORDER BY key').all(scope) as Array<{
      key: string;
      value: string;
    }>;
    return rows.map((r) => {
      try {
        return { key: r.key, value: JSON.parse(r.value) as T };
      } catch {
        return { key: r.key, value: r.value as unknown as T };
      }
    });
  }

  close(): void {
    this.db.close();
  }
}
