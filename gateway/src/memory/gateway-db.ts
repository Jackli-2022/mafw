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
  /** S3 encoding-time salience (0..1); null for legacy rows. */
  salience?: number | null;
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

export interface GoalOutcome {
  goal_id: string;
  project_id: string | null;
  verdict: string;
  rounds: number;
  duration_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  total_cost: number | null;
  tool_error_count: number | null;
  thumbs_up: number;
  thumbs_down: number;
  policy_version: string;
  evolution_proposal_id: string | null;
  failure_kind: string | null;
  failure_signature: string | null;
  /** D4b: task type at archive time (state.taskType; legacy rows null). */
  task_type?: string | null;
  created_at: string | null;
  archived_at: string;
}

export interface NodeRunRow {
  id: number;
  goal_id: string;
  project_id: string;
  loop: number;
  node: string;
  attempt: number;
  session_id: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  error: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
}

/** T2-1：会话检查点（gateway 服务端一等实体；auto/manual）。 */
export interface SessionCheckpointRow {
  id: string;
  session_id: string;
  project_dir: string;
  anchor_message_id: string;
  snapshot_tree: string | null;
  untracked_json: string;
  kind: string;
  created_at: string;
}

/** T2-2：回合软暂停运行状态。 */
export interface RunStateRow {
  id: string;
  session_id: string;
  project_dir: string;
  status: string;
  reason: string | null;
  brief_json: string;
  created_at: string;
  suspended_at: string;
  resumed_at: string | null;
  finished_at: string | null;
}

/** T2-3：data part overlay（session 作用域；message 归属）。 */
export interface SessionDataPartRow {
  session_id: string;
  id: string;
  message_id: string;
  type: string;
  data_json: string;
  created_at: string;
  updated_at: string;
}

export class GatewayDatabase {
  private db: Database.Database;

  /** 原始 better-sqlite3 句柄（2026-10-22：EventStore 等新模块注入用；既有表请走本类方法）。 */
  getStore(): Database.Database {
    return this.db;
  }

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
        salience REAL,
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
        provider TEXT,
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

      CREATE TABLE IF NOT EXISTS coactivation_units (
        unit_id    TEXT PRIMARY KEY,
        session_id TEXT,
        goal_id    TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_coact_units_session ON coactivation_units(session_id);
      CREATE INDEX IF NOT EXISTS idx_coact_units_goal    ON coactivation_units(goal_id);
      CREATE INDEX IF NOT EXISTS idx_coact_units_created ON coactivation_units(created_at);

      CREATE TABLE IF NOT EXISTS coactivation_edges (
        unit_a     TEXT NOT NULL,
        unit_b     TEXT NOT NULL,
        session_co REAL NOT NULL DEFAULT 0,
        goal_co    REAL NOT NULL DEFAULT 0,
        time_co    REAL NOT NULL DEFAULT 0,
        weight     REAL NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (unit_a, unit_b)
      );
      CREATE INDEX IF NOT EXISTS idx_coact_edges_a ON coactivation_edges(unit_a);
      CREATE INDEX IF NOT EXISTS idx_coact_edges_b ON coactivation_edges(unit_b);

      CREATE TABLE IF NOT EXISTS kv_store (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (scope, key)
      );

      CREATE TABLE IF NOT EXISTS t1_archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        failure INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        archived_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_t1_archive_session ON t1_archive(session_id, turn_id);

      CREATE TABLE IF NOT EXISTS t1_noop_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_noop_session ON t1_noop_log(session_id);
      CREATE INDEX IF NOT EXISTS idx_noop_created ON t1_noop_log(created_at);

      CREATE TABLE IF NOT EXISTS goal_outcomes (
        goal_id TEXT PRIMARY KEY,
        project_id TEXT,
        verdict TEXT NOT NULL,
        rounds INTEGER DEFAULT 0,
        duration_ms INTEGER,
        tokens_input INTEGER,
        tokens_output INTEGER,
        total_cost REAL,
        tool_error_count INTEGER,
        thumbs_up INTEGER DEFAULT 0,
        thumbs_down INTEGER DEFAULT 0,
        policy_version TEXT NOT NULL DEFAULT 'builtin-v1',
        evolution_proposal_id TEXT,
        failure_kind TEXT,
        failure_signature TEXT,
        created_at TEXT,
        archived_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goal_outcomes_policy ON goal_outcomes(policy_version, verdict);
      CREATE INDEX IF NOT EXISTS idx_goal_outcomes_project ON goal_outcomes(project_id, policy_version);

      CREATE TABLE IF NOT EXISTS goal_sessions (
        goal_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        loop INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_goal_sessions_session ON goal_sessions(session_id);

      CREATE TABLE IF NOT EXISTS goal_node_runs (
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
      CREATE INDEX IF NOT EXISTS idx_node_runs_goal ON goal_node_runs(goal_id, loop);

      CREATE TABLE IF NOT EXISTS evolution_proposals (
        id TEXT PRIMARY KEY,
        requires TEXT NOT NULL DEFAULT 'policy',
        component_diffs TEXT NOT NULL,
        declared_prediction TEXT,
        rationale TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        validation_result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_dir TEXT NOT NULL,
        anchor_message_id TEXT NOT NULL,
        snapshot_tree TEXT,
        untracked_json TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_checkpoints ON session_checkpoints(session_id, created_at);

      CREATE TABLE IF NOT EXISTS run_states (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_dir TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        brief_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        suspended_at TEXT NOT NULL,
        resumed_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_states ON run_states(session_id, created_at);

      CREATE TABLE IF NOT EXISTS session_data_parts (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_data_parts ON session_data_parts(session_id, message_id, created_at);
    `);

    // Migration: add assistant_text column to trajectory_turns if not exists
    try {
      this.db.exec(`ALTER TABLE trajectory_turns ADD COLUMN assistant_text TEXT`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: add provider column to trajectory_turns if not exists
    try {
      this.db.exec(`ALTER TABLE trajectory_turns ADD COLUMN provider TEXT`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: add worker_role column to trajectory_turns if not exists
    try {
      this.db.exec(`ALTER TABLE trajectory_turns ADD COLUMN worker_role TEXT`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: add salience column to t1_observations if not exists (S3
    // encoding-time salience tag; legacy rows read as null → neutral 0.5).
    try {
      this.db.exec(`ALTER TABLE t1_observations ADD COLUMN salience REAL`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: D4b task-type dimension on goal_outcomes (legacy rows NULL →
    // aggregate into the global/'other' bucket).
    try {
      this.db.exec(`ALTER TABLE goal_outcomes ADD COLUMN task_type TEXT`);
    } catch {
      // Column already exists, ignore
    }
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
        `INSERT OR IGNORE INTO t1_observations (session_id, turn_id, source, content, failure, salience)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(obs.session_id, obs.turn_id, obs.source, obs.content, obs.failure, obs.salience ?? null);
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

  /** conformance S3/S4：按会话取观察行（时间正序，截尾 limit）。 */
  getObservationsBySession(sessionID: string, limit = 100): Array<{ source: string; content: string }> {
    const rows = this.db
      .prepare('SELECT source, content FROM t1_observations WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionID, limit) as Array<{ source: string; content: string }>;
    return rows.reverse();
  }

  /** Remove all observations for a session up to (and including) a turn. */
  deleteTurn(session_id: string, turn_id: number): number {
    const result = this.db
      .prepare('DELETE FROM t1_observations WHERE session_id = ? AND turn_id = ?')
      .run(session_id, turn_id);
    return result.changes;
  }

  /**
   * Archive a processed turn: move from t1_observations to t1_archive, then
   * delete from t1_observations. Preserves the raw observation data for future
   * re-extraction with upgraded pipelines. Returns the number of rows archived.
   */
  archiveTurn(session_id: string, turn_id: number): number {
    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
           SELECT session_id, turn_id, source, content, failure, created_at
           FROM t1_observations WHERE session_id = ? AND turn_id = ?`,
        )
        .run(session_id, turn_id);
      const del = this.db
        .prepare('DELETE FROM t1_observations WHERE session_id = ? AND turn_id = ?')
        .run(session_id, turn_id);
      return del.changes;
    });
    return txn();
  }

  /** Read archived observations for a specific turn. */
  readArchiveTurn(session_id: string, turn_id: number): T1Observation[] {
    return this.db
      .prepare('SELECT * FROM t1_archive WHERE session_id = ? AND turn_id = ? ORDER BY id')
      .all(session_id, turn_id) as T1Observation[];
  }

  /** List archived turns (grouped), optionally filtered to a session. */
  listArchiveTurns(session_id?: string): TurnSummary[] {
    const where = session_id ? 'WHERE session_id = ?' : '';
    return this.db
      .prepare(
        `SELECT session_id, turn_id,
                COUNT(*) AS count,
                MAX(CASE WHEN source = 'user_input' THEN 1 ELSE 0 END) AS has_user_input,
                SUM(CASE WHEN source IN ('assistant_reply','tool_result','reasoning') AND length(trim(content)) > 0 THEN 1 ELSE 0 END) AS response_count,
                MAX(created_at) AS last_ts
         FROM t1_archive
         ${where}
         GROUP BY session_id, turn_id
         ORDER BY session_id, turn_id`,
      )
      .all(...(session_id ? [session_id] : [])) as TurnSummary[];
  }

  archiveCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM t1_archive').get() as { c: number }).c;
  }

  /** Search a session's archived turns by anchor substrings (LIKE), best-match first. */
  searchArchive(session_id: string, anchors: string[], k: number): T1Observation[] {
    if (!session_id || anchors.length === 0 || k <= 0) return [];
    const needle = anchors.map((a) => a.toLowerCase());
    const likes = needle.map(() => 'content LIKE ?').join(' OR ');
    const rows = this.db
      .prepare(`SELECT * FROM t1_archive WHERE session_id = ? AND (${likes}) ORDER BY turn_id LIMIT 200`)
      .all(session_id, ...needle.map((a) => `%${a}%`)) as T1Observation[];
    const scored = rows
      .map((r) => ({ r, hits: needle.filter((a) => (r.content || '').toLowerCase().includes(a)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.r.turn_id - b.r.turn_id);
    return scored.slice(0, k).map((x) => x.r);
  }

  /** V1 t1 pointer redemption: find archive rows by session-id tail + turn. */
  findArchiveBySessionTail(tail: string, turnId: number): T1Observation[] {
    if (!tail || !Number.isInteger(turnId) || turnId < 0) return [];
    return this.db
      .prepare(`SELECT * FROM t1_archive WHERE session_id LIKE '%' || ? || '%' AND turn_id = ? ORDER BY id LIMIT 50`)
      .all(tail, turnId) as T1Observation[];
  }

  // ── Noop log (extraction coverage monitoring) ──────────────────────────

  /**
   * Log a turn where the extraction worker decided nothing was worth saving.
   * Enables weekly review of what the worker skips — critical for diagnosing
   * whether preference/temporal misses happen at extraction or retrieval.
   */
  logNoop(session_id: string, turn_id: number, reason: string): void {
    this.db
      .prepare('INSERT INTO t1_noop_log (session_id, turn_id, reason) VALUES (?, ?, ?)')
      .run(session_id, turn_id, reason);
  }

  /** List noop log entries, optionally filtered by session and/or since timestamp. */
  listNoops(opts?: { session_id?: string; since?: number; limit?: number }): Array<{
    id: number;
    session_id: string;
    turn_id: number;
    reason: string;
    created_at: number;
  }> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (opts?.session_id) {
      conditions.push('session_id = ?');
      params.push(opts.session_id);
    }
    if (opts?.since) {
      conditions.push('created_at >= ?');
      params.push(opts.since);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts?.limit ?? 100;
    return this.db
      .prepare(`SELECT * FROM t1_noop_log ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as any[];
  }

  deleteSession(session_id: string): number {
    return this.db.prepare('DELETE FROM t1_observations WHERE session_id = ?').run(session_id).changes;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM t1_observations').get() as { c: number }).c;
  }

  // ── KV store (small critical state) ─────────────────────────────────────
  // Scope 归属规范（新增 scope 必须声明一类）：
  // - runtime-scoped：生命周期绑定当前 agent runtime（会话 id 属于 runtime 存储），
  //   切换时由 Scheduler.invalidateRuntimeScopedKv 统一失效——
  //   manager-session / internal-session / reflect-cursor
  // - durable：跨 runtime 有效——registry/snapshot / milestone-notified
  // runtime-scoped 条目的 value 必须携带 `at`（ISO 日期）供 TTL/审计。

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

  kvClearScope(scope: string): number {
    const info = this.db.prepare('DELETE FROM kv_store WHERE scope = ?').run(scope);
    return info.changes;
  }

  kvPruneOlderThan(scope: string, ttlDays: number): number {
    const now = Date.now();
    let removed = 0;
    for (const { key, value } of this.kvAll<Record<string, unknown>>(scope)) {
      const at = value && typeof value === 'object' ? (value as Record<string, unknown>).at : undefined;
      const ts = typeof at === 'string' ? Date.parse(at) : NaN;
      if (!isNaN(ts) && now - ts > ttlDays * 86_400_000) {
        this.kvDelete(scope, key);
        removed++;
      }
    }
    return removed;
  }

  // ── Goal outcomes (RSI Phase 1) ─────────────────────────────────────────

  upsertGoalOutcome(o: GoalOutcome): void {
    this.db.prepare(`
      INSERT INTO goal_outcomes (goal_id, project_id, verdict, rounds, duration_ms,
        tokens_input, tokens_output, total_cost, tool_error_count, thumbs_up, thumbs_down,
        policy_version, evolution_proposal_id, failure_kind, failure_signature, task_type, created_at, archived_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(goal_id) DO UPDATE SET
        verdict=excluded.verdict, rounds=excluded.rounds, duration_ms=excluded.duration_ms,
        tokens_input=excluded.tokens_input, tokens_output=excluded.tokens_output, total_cost=excluded.total_cost,
        tool_error_count=excluded.tool_error_count, thumbs_up=excluded.thumbs_up, thumbs_down=excluded.thumbs_down,
        policy_version=excluded.policy_version, evolution_proposal_id=excluded.evolution_proposal_id,
        failure_kind=excluded.failure_kind, failure_signature=excluded.failure_signature,
        task_type=excluded.task_type,
        created_at=excluded.created_at, archived_at=excluded.archived_at
    `).run(
      o.goal_id, o.project_id, o.verdict, o.rounds, o.duration_ms,
      o.tokens_input, o.tokens_output, o.total_cost, o.tool_error_count,
      o.thumbs_up, o.thumbs_down, o.policy_version, o.evolution_proposal_id,
      o.failure_kind, o.failure_signature, o.task_type ?? null, o.created_at, o.archived_at
    );
  }

  listGoalOutcomes(filter?: { policy?: string; verdict?: string; project?: string; taskType?: string; limit?: number }): GoalOutcome[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filter?.policy) { conditions.push('policy_version = ?'); params.push(filter.policy); }
    if (filter?.verdict) { conditions.push('verdict = ?'); params.push(filter.verdict); }
    if (filter?.project) { conditions.push('project_id = ?'); params.push(filter.project); }
    if (filter?.taskType) { conditions.push('task_type = ?'); params.push(filter.taskType); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 100;
    return this.db.prepare(`SELECT * FROM goal_outcomes ${where} ORDER BY archived_at DESC LIMIT ?`).all(...params, limit) as GoalOutcome[];
  }

  addGoalSession(s: { goal_id: string; session_id: string; phase: string; loop: number }): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO goal_sessions (goal_id, session_id, phase, loop, created_at)
      VALUES (?,?,?,?,datetime('now'))
    `).run(s.goal_id, s.session_id, s.phase, s.loop);
  }

  listGoalSessions(goalId: string): Array<{ session_id: string; phase: string; loop: number }> {
    return this.db.prepare('SELECT session_id, phase, loop FROM goal_sessions WHERE goal_id = ?').all(goalId) as any[];
  }

  /** Most recent archived outcome among the goals a session participated in
   *  (goal_sessions → goal_outcomes join). Powers the turn-compress curator's
   *  outcome-feedback signal (env-probing curation, grade gi). */
  getOutcomeForSession(sessionId: string): GoalOutcome | null {
    const row = this.db.prepare(`
      SELECT o.* FROM goal_outcomes o
      JOIN goal_sessions s ON s.goal_id = o.goal_id
      WHERE s.session_id = ?
      ORDER BY o.archived_at DESC LIMIT 1
    `).get(sessionId) as GoalOutcome | undefined;
    return row ?? null;
  }

  /** goal 节点级 trace（goal_node_runs 表）——NodeDriver 的 DFX 数据面。 */
  insertNodeRun(input: {
    goalId: string; projectId: string; loop: number; node: string;
    attempt: number; sessionId: string | null; startedAt: string;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO goal_node_runs (goal_id, project_id, loop, node, attempt, session_id, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(input.goalId, input.projectId, input.loop, input.node, input.attempt, input.sessionId, input.startedAt);
    return Number(info.lastInsertRowid);
  }

  finishNodeRun(id: number, patch: {
    status: string; finishedAt: string; outcome?: string | null; error?: string | null;
    tokensInput?: number | null; tokensOutput?: number | null; costUsd?: number | null;
  }): void {
    this.db.prepare(`
      UPDATE goal_node_runs
      SET status = ?, finished_at = ?,
          outcome = COALESCE(?, outcome), error = COALESCE(?, error),
          tokens_input = COALESCE(?, tokens_input), tokens_output = COALESCE(?, tokens_output),
          cost_usd = COALESCE(?, cost_usd)
      WHERE id = ?
    `).run(patch.status, patch.finishedAt, patch.outcome ?? null, patch.error ?? null,
      patch.tokensInput ?? null, patch.tokensOutput ?? null, patch.costUsd ?? null, id);
  }

  listNodeRuns(goalId: string): NodeRunRow[] {
    return this.db.prepare(
      'SELECT * FROM goal_node_runs WHERE goal_id = ? ORDER BY id ASC',
    ).all(goalId) as NodeRunRow[];
  }

  latestNodeAttempt(goalId: string, loop: number, node: string): NodeRunRow | null {
    const row = this.db.prepare(
      'SELECT * FROM goal_node_runs WHERE goal_id = ? AND loop = ? AND node = ? ORDER BY id DESC LIMIT 1',
    ).get(goalId, loop, node) as NodeRunRow | undefined;
    return row ?? null;
  }

  /** 最新归档 outcome（timeline 用）。 */
  getGoalOutcome(goalId: string): GoalOutcome | null {
    const row = this.db.prepare(
      'SELECT * FROM goal_outcomes WHERE goal_id = ? ORDER BY archived_at DESC LIMIT 1',
    ).get(goalId) as GoalOutcome | undefined;
    return row ?? null;
  }

  // ── T2-1 session checkpoints ──────────────────────────────────────────

  insertSessionCheckpoint(row: SessionCheckpointRow): void {
    this.db.prepare(
      `INSERT INTO session_checkpoints
         (id, session_id, project_dir, anchor_message_id, snapshot_tree, untracked_json, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.session_id, row.project_dir, row.anchor_message_id,
      row.snapshot_tree, row.untracked_json, row.kind, row.created_at,
    );
  }

  getSessionCheckpoint(id: string): SessionCheckpointRow | undefined {
    return this.db.prepare('SELECT * FROM session_checkpoints WHERE id = ?').get(id) as
      SessionCheckpointRow | undefined;
  }

  listSessionCheckpoints(sessionId: string): SessionCheckpointRow[] {
    return this.db.prepare(
      'SELECT * FROM session_checkpoints WHERE session_id = ? ORDER BY created_at DESC',
    ).all(sessionId) as SessionCheckpointRow[];
  }

  /** auto 检查点按会话保留最新 keep 条，返回删除数（manual 不受影响）。 */
  pruneSessionAutoCheckpoints(sessionId: string, keep: number): number {
    const result = this.db.prepare(
      `DELETE FROM session_checkpoints
       WHERE session_id = ? AND kind = 'auto' AND id NOT IN (
         SELECT id FROM session_checkpoints
         WHERE session_id = ? AND kind = 'auto'
         ORDER BY created_at DESC LIMIT ?
       )`,
    ).run(sessionId, sessionId, keep);
    return result.changes;
  }

  /** 时间线倒带：删除 created_at 严格晚于给定 ISO 的全部检查点（含 manual）。 */
  deleteSessionCheckpointsAfter(sessionId: string, createdAtIso: string): number {
    const result = this.db.prepare(
      'DELETE FROM session_checkpoints WHERE session_id = ? AND created_at > ?',
    ).run(sessionId, createdAtIso);
    return result.changes;
  }

  /** 截断型 restore：opencode revert 会删除 anchor 消息本身 → 目标条目也失效。
   *  删除 created_at >= 给定 ISO 的全部检查点（含目标自身）。 */
  deleteSessionCheckpointsFrom(sessionId: string, createdAtIso: string): number {
    const result = this.db.prepare(
      'DELETE FROM session_checkpoints WHERE session_id = ? AND created_at >= ?',
    ).run(sessionId, createdAtIso);
    return result.changes;
  }

  /** 单条删除（files restore 失败时回收 pre-restore 行）。 */
  deleteSessionCheckpoint(id: string): void {
    this.db.prepare('DELETE FROM session_checkpoints WHERE id = ?').run(id);
  }

  deleteSessionCheckpoints(sessionId: string): void {
    this.db.prepare('DELETE FROM session_checkpoints WHERE session_id = ?').run(sessionId);
  }

  // ── T2-2 run states ───────────────────────────────────────────────────

  insertRunState(row: RunStateRow): void {
    this.db.prepare(
      `INSERT INTO run_states
         (id, session_id, project_dir, status, reason, brief_json, created_at, suspended_at, resumed_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.session_id, row.project_dir, row.status, row.reason, row.brief_json,
      row.created_at, row.suspended_at, row.resumed_at, row.finished_at,
    );
  }

  getRunState(id: string): RunStateRow | undefined {
    return this.db.prepare('SELECT * FROM run_states WHERE id = ?').get(id) as RunStateRow | undefined;
  }

  getActiveRunState(sessionId: string): RunStateRow | undefined {
    return this.db.prepare(
      `SELECT * FROM run_states
       WHERE session_id = ? AND status IN ('suspended','resumed')
       ORDER BY created_at DESC LIMIT 1`,
    ).get(sessionId) as RunStateRow | undefined;
  }

  listActiveRunStates(): RunStateRow[] {
    return this.db.prepare(
      `SELECT * FROM run_states WHERE status IN ('suspended','resumed') ORDER BY created_at DESC`,
    ).all() as RunStateRow[];
  }

  updateRunState(
    id: string,
    patch: Partial<Pick<RunStateRow, 'status' | 'resumed_at' | 'finished_at' | 'reason'>>,
  ): void {
    const current = this.getRunState(id);
    if (!current) return;
    this.db.prepare(
      `UPDATE run_states SET status = ?, reason = ?, resumed_at = ?, finished_at = ? WHERE id = ?`,
    ).run(
      patch.status ?? current.status,
      patch.reason !== undefined ? patch.reason : current.reason,
      patch.resumed_at !== undefined ? patch.resumed_at : current.resumed_at,
      patch.finished_at !== undefined ? patch.finished_at : current.finished_at,
      id,
    );
  }

  /** 仅修剪终态 run（活跃 run 永不删除）；保留最新 keep 条终态。 */
  pruneRunStates(sessionId: string, keep: number): number {
    const result = this.db.prepare(
      `DELETE FROM run_states
       WHERE session_id = ? AND status NOT IN ('suspended','resumed') AND id NOT IN (
         SELECT id FROM run_states
         WHERE session_id = ? AND status NOT IN ('suspended','resumed')
         ORDER BY created_at DESC LIMIT ?
       )`,
    ).run(sessionId, sessionId, keep);
    return result.changes;
  }

  deleteRunStates(sessionId: string): void {
    this.db.prepare('DELETE FROM run_states WHERE session_id = ?').run(sessionId);
  }

  // ── T2-3 session data parts ──────────────────────────────────────────

  upsertSessionDataPart(row: SessionDataPartRow): void {
    this.db.prepare(
      `INSERT INTO session_data_parts
         (session_id, id, message_id, type, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id, id) DO UPDATE SET
         message_id = excluded.message_id,
         type = excluded.type,
         data_json = excluded.data_json,
         updated_at = excluded.updated_at`,
    ).run(
      row.session_id, row.id, row.message_id, row.type,
      row.data_json, row.created_at, row.updated_at,
    );
  }

  getSessionDataPart(sessionId: string, id: string): SessionDataPartRow | undefined {
    return this.db.prepare(
      'SELECT * FROM session_data_parts WHERE session_id = ? AND id = ?',
    ).get(sessionId, id) as SessionDataPartRow | undefined;
  }

  listSessionDataParts(
    sessionId: string,
    opts?: { messageIds?: string[] },
  ): SessionDataPartRow[] {
    const ids = opts?.messageIds;
    if (Array.isArray(ids)) {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      return this.db.prepare(
        `SELECT * FROM session_data_parts
         WHERE session_id = ? AND message_id IN (${placeholders})
         ORDER BY created_at ASC, rowid ASC`,
      ).all(sessionId, ...ids) as SessionDataPartRow[];
    }
    return this.db.prepare(
      'SELECT * FROM session_data_parts WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
    ).all(sessionId) as SessionDataPartRow[];
  }

  deleteSessionDataPart(sessionId: string, id: string): void {
    this.db.prepare(
      'DELETE FROM session_data_parts WHERE session_id = ? AND id = ?',
    ).run(sessionId, id);
  }

  /** 每会话保留最新 keep 行（按 updated_at：同 id 热更新不得被旧 created_at 淘汰）。 */
  pruneSessionDataParts(sessionId: string, keep: number): number {
    const result = this.db.prepare(
      `DELETE FROM session_data_parts
       WHERE session_id = ? AND rowid NOT IN (
         SELECT rowid FROM session_data_parts
         WHERE session_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?
       )`,
    ).run(sessionId, sessionId, keep);
    return result.changes;
  }

  deleteSessionDataParts(sessionId: string): void {
    this.db.prepare('DELETE FROM session_data_parts WHERE session_id = ?').run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}
