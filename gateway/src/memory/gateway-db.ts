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
import { randomUUID, createHash } from 'crypto';
import Database from 'better-sqlite3';
import { log } from '../core/utils/logger';
import { ensureEventLayerSchema } from '../core/events/event-store';

export type ObservationSource = 'user_input' | 'assistant_reply' | 'tool_result' | 'reasoning';

export interface T1Observation {
  id: number;
  session_id: string;
  turn_id: number;
  /** Logical turn trace (`t1_turns.trace_id`) the observation belongs to;
   *  null for legacy rows until the Task 4 backfill. */
  trace_id: string | null;
  /** Stable per-observation identity (`t1o_<uuid>`); null for legacy rows
   *  until the Task 4 backfill. */
  observation_key: string | null;
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

/** Durable logical turn identity (T1); survives archival and restarts. */
export interface T1Turn {
  trace_id: string;
  session_id: string;
  turn_seq: number;
  created_at: number;
  archived_at: number | null;
  encoding_salience: number | null;
  legacy_ambiguous: number;
}

/** A turn's full observation set (active + archived) resolved by trace id. */
export interface T1TraceRead {
  turn: T1Turn;
  rows: T1Observation[];
  /** Whether the turn is currently archived (from `t1_turns.archived_at`). */
  archived: boolean;
}

export type T1RetrievalKind = 'search' | 'recall' | 'redeem';

/** One lexical T1 hit (best row per trace, ordered by FTS bm25). */
export interface T1LexicalHit {
  traceId: string;
  sessionId: string;
  turnId: number;
  source: string;
  excerpt: string;
  /** FTS5 bm25 rank (lower is better). */
  rank: number;
}

/**
 * Turn a user query into a safe FTS5 MATCH expression: every token of at
 * least three characters is double-quoted (so `.`/`-`/`:` are literal) and
 * joined with OR. Returns '' when no token is trigram-eligible.
 */
export function buildT1FtsQuery(query: string): string {
  const tokens = String(query || '').match(/[\p{L}\p{N}_./:\\-]{3,}/gu) ?? [];
  const unique = Array.from(new Set(tokens.map((t) => t.toLowerCase()))).slice(0, 12);
  return unique.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export interface T1RetrievalStats {
  total: number;
  byKind: Record<T1RetrievalKind, number>;
  uniqueTraces: number;
  lastAt: number | null;
}

/** Bounded activation state for one T1 trace. */
export interface T1TraceActivation {
  activation: number;
  retrievalCount: number;
  lastRetrievedAt: number | null;
  lastReplayedAt: number | null;
  activationUpdatedAt: number;
}

const T1_RETRIEVAL_KINDS: T1RetrievalKind[] = ['search', 'recall', 'redeem'];

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
  /** Goal revision (append-only 打回循环的轮次)；legacy 行读回 1。 */
  revision: number;
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
        trace_id TEXT,
        observation_key TEXT,
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
        trace_id TEXT,
        observation_key TEXT,
        source TEXT NOT NULL,
        content TEXT NOT NULL,
        failure INTEGER DEFAULT 0,
        salience REAL,
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

      CREATE TABLE IF NOT EXISTS t1_turns (
        trace_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_seq INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        archived_at INTEGER,
        encoding_salience REAL,
        legacy_ambiguous INTEGER NOT NULL DEFAULT 0,
        UNIQUE(session_id, turn_seq)
      );
      CREATE INDEX IF NOT EXISTS idx_t1_turns_session ON t1_turns(session_id, turn_seq);

      -- Lexical derivative of T1 (rebuildable): trigram tokenizer supports
      -- identifier/path/error-code substring matching that dense retrieval
      -- misses. Metadata columns are UNINDEXED so deletes can target keys.
      CREATE VIRTUAL TABLE IF NOT EXISTS t1_fts USING fts5(
        content,
        trace_id UNINDEXED,
        observation_key UNINDEXED,
        session_id UNINDEXED,
        turn_id UNINDEXED,
        source UNINDEXED,
        tokenize='trigram'
      );

      CREATE TABLE IF NOT EXISTS t1_retrieval_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        score REAL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_t1_retrieval_trace ON t1_retrieval_events(trace_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_t1_retrieval_created ON t1_retrieval_events(created_at);

      -- Bounded activation state for T1 traces. Written from observe-only
      -- retrieval events and exact memory provenance; consumed by a later
      -- ranking phase (this table must not affect retrieval on its own).
      CREATE TABLE IF NOT EXISTS t1_trace_state (
        trace_id TEXT PRIMARY KEY,
        activation REAL NOT NULL DEFAULT 0,
        retrieval_count INTEGER NOT NULL DEFAULT 0,
        last_retrieved_at INTEGER,
        last_replayed_at INTEGER,
        activation_updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_t1_state_activation ON t1_trace_state(activation);

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
        revision INTEGER NOT NULL DEFAULT 1,
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

    ensureEventLayerSchema(this.db);

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

    // Migration: add stable observation identity columns (logical turn trace
    // + per-observation key) to t1_observations if not exists. Legacy rows
    // read back null for both; new appends always populate them.
    try {
      this.db.exec(`ALTER TABLE t1_observations ADD COLUMN trace_id TEXT`);
    } catch {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE t1_observations ADD COLUMN observation_key TEXT`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: copy stable observation identity (logical turn trace +
    // per-observation key) and salience onto t1_archive so archived rows keep
    // the same identity as their active counterparts. Legacy archived rows
    // read back null for all three.
    try {
      this.db.exec(`ALTER TABLE t1_archive ADD COLUMN trace_id TEXT`);
    } catch {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE t1_archive ADD COLUMN observation_key TEXT`);
    } catch {
      // Column already exists, ignore
    }
    try {
      this.db.exec(`ALTER TABLE t1_archive ADD COLUMN salience REAL`);
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

    // Migration: Goal revision dimension on goal_node_runs（打回循环的
    // append-only 轮次；legacy 行按 DEFAULT 1 读回 revision 1）。
    try {
      this.db.exec(`ALTER TABLE goal_node_runs ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`);
    } catch {
      // Column already exists, ignore
    }
    // Index 必须在 ALTER 之后建：legacy 库的旧表没有 revision 列。
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_node_runs_goal_revision
        ON goal_node_runs(goal_id, revision, loop);
    `);

    // Task 4: backfill durable identity onto pre-Task-4 legacy rows. Idempotent
    // and transactional; a failure is logged and must never block startup.
    this.migrateT1Identity();
    // Lexical index is a rebuildable derivative of the immutable T1 rows.
    this.rebuildT1FtsIfEmpty();
  }

  /**
   * Constructor-time, idempotent legacy migration: give every pre-Task-4
   * `(session_id, turn_id)` composite a durable `t1_turns` identity and link
   * its observation rows to that trace, without ever merging, rewriting, or
   * deleting legacy observation content.
   *
   * Rules (per the T1 identity plan):
   *  - one `t1_turns` row per legacy composite key, keyed by a deterministic
   *    `t1l_<sha1(session_id + NUL + turn_id).slice(0,20)>` trace;
   *  - `legacy_ambiguous = 1` when the composite holds more than one
   *    `user_input`, or spans both active and archive tables (never guess a
   *    precise historical boundary);
   *  - every legacy observation row receives its composite trace plus a
   *    table-scoped observation key (`t1o_legacy_active_<id>` /
   *    `t1o_legacy_archive_<id>`);
   *  - `turn_seq` equals the legacy `turn_id`, so the next allocated sequence
   *    is always greater than every legacy sequence.
   *
   * Only rows whose `trace_id` is still NULL are touched, so re-running on
   * every startup neither duplicates `t1_turns` rows nor overwrites the
   * identity of turns allocated by `beginTurn`. Runs in one transaction; any
   * failure is logged and swallowed so gateway startup is unaffected, with no
   * partial commit.
   */
  private migrateT1Identity(): void {
    try {
      // Trace/observation-key indexes must come after the ALTERs that add the
      // columns (legacy tables predate them).
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_t1_observations_trace ON t1_observations(trace_id);
        CREATE INDEX IF NOT EXISTS idx_t1_observations_key ON t1_observations(observation_key);
        CREATE INDEX IF NOT EXISTS idx_t1_archive_trace ON t1_archive(trace_id);
        CREATE INDEX IF NOT EXISTS idx_t1_archive_key ON t1_archive(observation_key);
      `);

      const txn = this.db.transaction(() => {
        const composites = this.db
          .prepare(
            `SELECT session_id, turn_id,
                    SUM(user_input) AS user_input_count,
                    MAX(active)    AS has_active,
                    MAX(archive)   AS has_archive,
                    MIN(created_at)    AS min_created_at,
                    MAX(archived_at)   AS max_archived_at,
                    MAX(salience)      AS max_salience
             FROM (
               SELECT session_id, turn_id,
                      CASE WHEN source = 'user_input' THEN 1 ELSE 0 END AS user_input,
                      1 AS active, 0 AS archive,
                      created_at, NULL AS archived_at, salience
                 FROM t1_observations
                WHERE trace_id IS NULL
               UNION ALL
               SELECT session_id, turn_id,
                      CASE WHEN source = 'user_input' THEN 1 ELSE 0 END AS user_input,
                      0 AS active, 1 AS archive,
                      created_at, archived_at, salience
                 FROM t1_archive
                WHERE trace_id IS NULL
             )
             GROUP BY session_id, turn_id`,
          )
          .all() as Array<{
            session_id: string;
            turn_id: number;
            user_input_count: number;
            has_active: number;
            has_archive: number;
            min_created_at: number | null;
            max_archived_at: number | null;
            max_salience: number | null;
          }>;

        const insertTurn = this.db.prepare(
          `INSERT OR IGNORE INTO t1_turns
             (trace_id, session_id, turn_seq, created_at, archived_at, encoding_salience, legacy_ambiguous)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const backfillActive = this.db.prepare(
          `UPDATE t1_observations
              SET trace_id = ?, observation_key = 't1o_legacy_active_' || id
            WHERE session_id = ? AND turn_id = ? AND trace_id IS NULL`,
        );
        const backfillArchive = this.db.prepare(
          `UPDATE t1_archive
              SET trace_id = ?, observation_key = 't1o_legacy_archive_' || id
            WHERE session_id = ? AND turn_id = ? AND trace_id IS NULL`,
        );

        let turnsCreated = 0;
        let ambiguousTurns = 0;
        let rowsBackfilled = 0;
        for (const c of composites) {
          const trace =
            't1l_' +
            createHash('sha1')
              .update(`${c.session_id}\0${c.turn_id}`)
              .digest('hex')
              .slice(0, 20);
          const ambiguous =
            c.user_input_count > 1 || (c.has_active === 1 && c.has_archive === 1) ? 1 : 0;
          // A turn is "archived" only when it has archive rows and no active
          // rows; a composite spanning both is left open (and marked ambiguous).
          const archivedAt =
            c.has_archive === 1 && c.has_active === 0 ? c.max_archived_at : null;
          const createdAt = c.min_created_at ?? Math.floor(Date.now() / 1000);
          turnsCreated += insertTurn.run(
            trace,
            c.session_id,
            c.turn_id,
            createdAt,
            archivedAt,
            c.max_salience,
            ambiguous,
          ).changes;
          if (ambiguous) ambiguousTurns += 1;
          rowsBackfilled += backfillActive.run(trace, c.session_id, c.turn_id).changes;
          rowsBackfilled += backfillArchive.run(trace, c.session_id, c.turn_id).changes;
        }
        return { turnsCreated, ambiguousTurns, rowsBackfilled };
      });
      const { turnsCreated, ambiguousTurns, rowsBackfilled } = txn();
      log.info('t1 identity legacy migration complete', {
        turnsCreated,
        ambiguousTurns,
        rowsBackfilled,
      });
    } catch (err) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      log.error('t1 identity legacy migration failed (startup continues)', detail);
    }
  }

  // ── T1 observations ─────────────────────────────────────────────────────

  /**
   * Highest logical turn sequence + 1 for a session, computed over the union of
   * allocated turns (t1_turns), active observations (t1_observations), and
   * archived observations (t1_archive). Including archived rows guarantees
   * untracked legacy fixtures can never cause a turn number to be reused, and
   * archiving every active row does not reset the sequence.
   */
  private nextTurnSeq(session_id: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(turn_seq) AS m FROM (
           SELECT turn_seq FROM t1_turns WHERE session_id = ?
           UNION ALL
           SELECT turn_id AS turn_seq FROM t1_observations WHERE session_id = ?
           UNION ALL
           SELECT turn_id AS turn_seq FROM t1_archive WHERE session_id = ?
         )`,
      )
      .get(session_id, session_id, session_id) as { m: number | null };
    return (row.m ?? 0) + 1;
  }

  /**
   * Next turn ID for a new user message: highest known logical turn (active or
   * archived) + 1. Non-allocating peek: repeated calls do not advance anything.
   * No rows yet → 1.
   */
  nextTurnId(session_id: string): number {
    return this.nextTurnSeq(session_id);
  }

  /** Current turn ID for non-user observations: latest logical turn, or 0. */
  currentTurnId(session_id: string): number {
    return this.currentTurn(session_id)?.turn_seq ?? 0;
  }

  /** Latest logical turn for the session regardless of archived state. */
  currentTurn(session_id: string): T1Turn | null {
    const row = this.db
      .prepare('SELECT * FROM t1_turns WHERE session_id = ? ORDER BY turn_seq DESC LIMIT 1')
      .get(session_id) as T1Turn | undefined;
    return row ?? null;
  }

  /**
   * Allocate one new logical turn for a session and return it. Runs in a
   * transaction: computes the next sequence from the union of turns /
   * observations / archive, inserts a `t1t_` trace-id row, and returns the
   * inserted row. The sequence is persisted, so restarts and archivals cannot
   * renumber or duplicate turns.
   */
  beginTurn(session_id: string, encodingSalience?: number): T1Turn {
    const txn = this.db.transaction((): T1Turn => {
      const turn_seq = this.nextTurnSeq(session_id);
      const trace_id = `t1t_${randomUUID()}`;
      this.db
        .prepare(
          `INSERT INTO t1_turns (trace_id, session_id, turn_seq, created_at, encoding_salience)
           VALUES (?, ?, ?, unixepoch(), ?)`,
        )
        .run(trace_id, session_id, turn_seq, encodingSalience ?? null);
      return this.db.prepare('SELECT * FROM t1_turns WHERE trace_id = ?').get(trace_id) as T1Turn;
    });
    return txn();
  }

  /**
   * Insert one observation against an allocated logical turn.
   *
   * `trace_id` is required and must reference an existing `t1_turns` row
   * (`trace_id required` / `unknown trace_id: <id>` otherwise). The referenced
   * turn's `(session_id, turn_seq)` must match `obs.session_id` /
   * `obs.turn_id` (`trace ownership mismatch: ...` otherwise). A missing
   * `observation_key` is generated as `t1o_<uuid>`. On write, the turn's
   * `encoding_salience` is raised to the maximum supplied salience.
   *
   * Database-level dedup via the UNIQUE constraint: a duplicate
   * (same session/turn/source/content) is silently ignored. Returns the row
   * id, or null when deduplicated.
   */
  append(obs: {
    session_id: string;
    turn_id: number;
    trace_id: string;
    observation_key?: string;
    source: ObservationSource;
    content: string;
    failure: number;
    salience?: number | null;
  }): number | null {
    if (!obs.trace_id || !obs.trace_id.trim()) {
      throw new Error('trace_id required');
    }
    const turn = this.db
      .prepare('SELECT trace_id, session_id, turn_seq FROM t1_turns WHERE trace_id = ?')
      .get(obs.trace_id) as { trace_id: string; session_id: string; turn_seq: number } | undefined;
    if (!turn) {
      throw new Error(`unknown trace_id: ${obs.trace_id}`);
    }
    if (turn.session_id !== obs.session_id || turn.turn_seq !== obs.turn_id) {
      throw new Error(
        `trace ownership mismatch: trace_id ${obs.trace_id} owns ` +
          `(session_id, turn_seq)=(${turn.session_id}, ${turn.turn_seq}) but append targeted ` +
          `(session_id, turn_id)=(${obs.session_id}, ${obs.turn_id})`,
      );
    }
    const observationKey = obs.observation_key || `t1o_${randomUUID()}`;
    const txn = this.db.transaction((): number | null => {
      const result = this.db
        .prepare(
          `INSERT OR IGNORE INTO t1_observations (session_id, turn_id, trace_id, observation_key, source, content, failure, salience)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          obs.session_id,
          obs.turn_id,
          obs.trace_id,
          observationKey,
          obs.source,
          obs.content,
          obs.failure,
          obs.salience ?? null,
        );
      // Raise — never lower — the turn's encoding salience.
      if (obs.salience != null) {
        this.db
          .prepare(
            `UPDATE t1_turns
                SET encoding_salience = MAX(COALESCE(encoding_salience, 0), ?)
              WHERE trace_id = ?`,
          )
          .run(obs.salience, obs.trace_id);
      }
      // A late observation reopens an archived turn (identity unchanged).
      if (result.changes > 0) {
        this.db
          .prepare('UPDATE t1_turns SET archived_at = NULL WHERE trace_id = ?')
          .run(obs.trace_id);
        // Lexical derivative: same content, same observation key across the
        // obs→archive move, so archiving needs no FTS change. Fail-open — a
        // broken derivative index must never reject the raw observation.
        try {
          this.db
            .prepare(
              `INSERT INTO t1_fts (content, trace_id, observation_key, session_id, turn_id, source)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(obs.content, obs.trace_id, observationKey, obs.session_id, obs.turn_id, obs.source);
        } catch (err: any) {
          log.warn(`[T1FTS] append indexing failed (raw row kept): ${err?.message || err}`);
        }
      }
      return result.changes > 0 ? Number(result.lastInsertRowid) : null;
    });
    return txn();
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
    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM t1_fts WHERE observation_key IN
             (SELECT observation_key FROM t1_observations WHERE session_id = ? AND turn_id = ?)`,
        )
        .run(session_id, turn_id);
      return this.db
        .prepare('DELETE FROM t1_observations WHERE session_id = ? AND turn_id = ?')
        .run(session_id, turn_id).changes;
    });
    return txn();
  }

  /**
   * Archive a processed turn: move from t1_observations to t1_archive, then
   * delete from t1_observations. Preserves the raw observation data (including
   * the logical trace id, observation key, and salience) for future
   * re-extraction with upgraded pipelines, and stamps `t1_turns.archived_at`
   * to record when the turn was archived. Returns the number of rows archived.
   */
  archiveTurn(session_id: string, turn_id: number): number {
    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO t1_archive (session_id, turn_id, trace_id, observation_key, source, content, failure, salience, created_at)
           SELECT session_id, turn_id, trace_id, observation_key, source, content, failure, salience, created_at
           FROM t1_observations WHERE session_id = ? AND turn_id = ?`,
        )
        .run(session_id, turn_id);
      const del = this.db
        .prepare('DELETE FROM t1_observations WHERE session_id = ? AND turn_id = ?')
        .run(session_id, turn_id);
      if (del.changes > 0) {
        this.db
          .prepare('UPDATE t1_turns SET archived_at = unixepoch() WHERE session_id = ? AND turn_seq = ?')
          .run(session_id, turn_id);
      }
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

  /** Cheap existence check for provenance validation (never loads rows). */
  hasTrace(traceId: string): boolean {
    const id = String(traceId || '').trim();
    if (!id) return false;
    try {
      return Boolean(this.db.prepare('SELECT 1 FROM t1_turns WHERE trace_id = ?').get(id));
    } catch {
      return false;
    }
  }

  /**
   * Read a turn's full observation set by logical trace id, combining active
   * (t1_observations) and archived (t1_archive) rows. Rows are ordered by
   * `created_at`, then stable row id within each source (archived rows sort
   * before active rows on created_at ties, preserving replay order across an
   * archival/reopen cycle). Returns `archived` from the turn metadata.
   * Returns null when the trace id is unknown.
   */
  readTrace(trace_id: string): T1TraceRead | null {
    const turn = this.db
      .prepare('SELECT * FROM t1_turns WHERE trace_id = ?')
      .get(trace_id) as T1Turn | undefined;
    if (!turn) return null;
    const rows = this.db
      .prepare(
        `SELECT id, session_id, turn_id, trace_id, observation_key, source, content, failure, salience, created_at
         FROM (
           SELECT id, session_id, turn_id, trace_id, observation_key, source, content, failure, salience, created_at, 0 AS src
             FROM t1_archive WHERE trace_id = ?
           UNION ALL
           SELECT id, session_id, turn_id, trace_id, observation_key, source, content, failure, salience, created_at, 1 AS src
             FROM t1_observations WHERE trace_id = ?
         )
         ORDER BY created_at, src, id`,
      )
      .all(trace_id, trace_id) as T1Observation[];
    return { turn, rows, archived: turn.archived_at != null };
  }

  /** Observe-only T1 access event + bounded trace activation update. */
  recordT1RetrievalEvent(event: {
    traceId: string;
    kind: T1RetrievalKind;
    score?: number;
    ts?: number;
  }): void {
    const traceId = String(event?.traceId || '').trim();
    if (!traceId || !T1_RETRIEVAL_KINDS.includes(event.kind)) return;
    const now = Math.floor(Date.now() / 1000);
    try {
      const txn = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO t1_retrieval_events (trace_id, kind, score, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(
            traceId,
            event.kind,
            Number.isFinite(event.score) ? event.score : null,
            Number.isFinite(event.ts) ? event.ts : now,
          );
        // Activation is a state field only: bounded increment, no ranking read.
        const inserted = this.db
          .prepare(
            `INSERT OR IGNORE INTO t1_trace_state
               (trace_id, activation, retrieval_count, last_retrieved_at, activation_updated_at)
             SELECT trace_id, 0.1, 1, ?, ? FROM t1_turns WHERE trace_id = ?`,
          )
          .run(now, now, traceId).changes;
        if (!inserted) {
          this.db
            .prepare(
              `UPDATE t1_trace_state
                  SET activation = MIN(1.0, activation + 0.1),
                      retrieval_count = retrieval_count + 1,
                      last_retrieved_at = ?,
                      activation_updated_at = ?
                WHERE trace_id = ?`,
            )
            .run(now, now, traceId);
        }
      });
      txn();
    } catch (err: any) {
      log.warn(`[T1Retrieval] record failed: ${err?.message || err}`);
    }
  }

  /** Read one trace's bounded activation state. */
  t1TraceActivation(traceId: string): T1TraceActivation | null {
    const id = String(traceId || '').trim();
    if (!id) return null;
    try {
      const row = this.db
        .prepare(
          `SELECT activation, retrieval_count, last_retrieved_at, last_replayed_at, activation_updated_at
           FROM t1_trace_state WHERE trace_id = ?`,
        )
        .get(id) as
        | {
            activation: number;
            retrieval_count: number;
            last_retrieved_at: number | null;
            last_replayed_at: number | null;
            activation_updated_at: number;
          }
        | undefined;
      if (!row) return null;
      return {
        activation: row.activation,
        retrievalCount: row.retrieval_count,
        lastRetrievedAt: row.last_retrieved_at,
        lastReplayedAt: row.last_replayed_at,
        activationUpdatedAt: row.activation_updated_at,
      };
    } catch {
      return null;
    }
  }

  /**
   * Abstract→T1 propagation: a redeemed memory with exact source traces gives
   * those raw traces a small bounded activation increment. Unknown ids and
   * non-positive weights are ignored.
   */
  propagateT1Activation(traceIds: string[], weight = 0.05): number {
    const ids = Array.from(new Set((traceIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (ids.length === 0) return 0;
    const amount = Number.isFinite(weight) ? Math.min(0.2, Math.max(0, weight)) : 0;
    const now = Math.floor(Date.now() / 1000);
    let touched = 0;
    try {
      const txn = this.db.transaction(() => {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO t1_trace_state
             (trace_id, activation, retrieval_count, last_retrieved_at, activation_updated_at)
           SELECT trace_id, ?, 0, NULL, ? FROM t1_turns WHERE trace_id = ?`,
        );
        const update = this.db.prepare(
          `UPDATE t1_trace_state
              SET activation = MIN(1.0, activation + ?),
                  activation_updated_at = ?
            WHERE trace_id = ?`,
        );
        for (const id of ids) {
          const inserted = insert.run(amount, now, id).changes;
          if (inserted > 0) {
            touched++;
          } else if (update.run(amount, now, id).changes > 0) {
            touched++;
          }
        }
      });
      txn();
    } catch (err: any) {
      log.warn(`[T1Activation] propagate failed: ${err?.message || err}`);
      return 0;
    }
    return touched;
  }

  /** Daily exponential decay of T1 trace activation (default half-life 14d). */
  decayT1TraceState(opts: { now?: number; halfLifeDays?: number } = {}): number {
    const now = Number.isFinite(opts.now) ? opts.now! : Math.floor(Date.now() / 1000);
    const halfLifeDays = Number.isFinite(opts.halfLifeDays) ? opts.halfLifeDays! : 14;
    if (!(halfLifeDays > 0)) return 0;
    try {
      const rows = this.db
        .prepare(
          `SELECT trace_id, activation, activation_updated_at
             FROM t1_trace_state WHERE activation > 0`,
        )
        .all() as Array<{ trace_id: string; activation: number; activation_updated_at: number }>;
      if (rows.length === 0) return 0;
      let changed = 0;
      const txn = this.db.transaction(() => {
        const update = this.db.prepare(
          'UPDATE t1_trace_state SET activation = ?, activation_updated_at = ? WHERE trace_id = ?',
        );
        for (const row of rows) {
          const days = Math.max(0, (now - row.activation_updated_at) / 86400);
          if (days <= 0) continue;
          let next = row.activation * Math.pow(0.5, days / halfLifeDays);
          if (next < 0.01) next = 0;
          update.run(next, now, row.trace_id);
          changed++;
        }
      });
      txn();
      return changed;
    } catch (err: any) {
      log.warn(`[T1Activation] decay failed: ${err?.message || err}`);
      return 0;
    }
  }

  /** Batch activation lookup for bounded re-ranking (cap 100 ids). */
  t1Activations(traceIds: string[]): Map<string, number> {
    const out = new Map<string, number>();
    const ids: string[] = [];
    for (const raw of traceIds || []) {
      const id = String(raw || '').trim();
      if (!id || out.has(id) || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= 100) break;
    }
    if (ids.length === 0) return out;
    try {
      const placeholders = ids.map(() => '?').join(',');
      const rows = this.db
        .prepare(`SELECT trace_id, activation FROM t1_trace_state WHERE trace_id IN (${placeholders})`)
        .all(...ids) as Array<{ trace_id: string; activation: number }>;
      for (const row of rows) out.set(row.trace_id, row.activation);
    } catch { /* fail-open: relevance order wins */ }
    return out;
  }

  /**
   * Highest-activation known traces for bounded replay selection. Zero/unknown
   * rows are excluded; limit is capped at 100.
   */
  topActivatedTraces(
    limit: number,
    opts: { minActivation?: number } = {},
  ): Array<{ traceId: string; activation: number }> {
    const n = Math.max(0, Math.min(100, Math.floor(Number(limit) || 0)));
    if (n === 0) return [];
    const floor = Number.isFinite(opts.minActivation) ? opts.minActivation! : 0;
    try {
      const rows = this.db
        .prepare(
          `SELECT s.trace_id, s.activation
             FROM t1_trace_state s
            WHERE s.activation > 0 AND s.activation >= ?
              AND EXISTS (SELECT 1 FROM t1_turns t WHERE t.trace_id = s.trace_id)
            ORDER BY s.activation DESC, s.trace_id
            LIMIT ?`,
        )
        .all(floor, n) as Array<{ trace_id: string; activation: number }>;
      return rows.map((row) => ({ traceId: row.trace_id, activation: row.activation }));
    } catch {
      return [];
    }
  }

  /** Stamp replay exposure for known traces (state only; no activation bump). */
  markT1Replayed(traceIds: string[], ts?: number): number {
    const ids: string[] = [];
    for (const raw of traceIds || []) {
      const id = String(raw || '').trim();
      if (!id || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= 100) break;
    }
    if (ids.length === 0) return 0;
    const at = Number.isFinite(ts) ? ts! : Math.floor(Date.now() / 1000);
    const now = Math.floor(Date.now() / 1000);
    try {
      let touched = 0;
      const txn = this.db.transaction(() => {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO t1_trace_state
             (trace_id, activation, retrieval_count, last_replayed_at, activation_updated_at)
           SELECT trace_id, 0, 0, ?, ? FROM t1_turns WHERE trace_id = ?`,
        );
        const update = this.db.prepare(
          'UPDATE t1_trace_state SET last_replayed_at = ? WHERE trace_id = ?',
        );
        for (const id of ids) {
          if (insert.run(at, now, id).changes > 0) touched++;
          else if (update.run(at, id).changes > 0) touched++;
        }
      });
      txn();
      return touched;
    } catch (err: any) {
      log.warn(`[T1Replay] mark failed: ${err?.message || err}`);
      return 0;
    }
  }

  /** Aggregate activation state for /api/memory/stats. */
  t1ActivationStats(): { traces: number; mean: number; max: number } {
    try {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS traces, AVG(activation) AS mean, MAX(activation) AS max
             FROM t1_trace_state`,
        )
        .get() as { traces: number; mean: number | null; max: number | null };
      return { traces: row.traces ?? 0, mean: row.mean ?? 0, max: row.max ?? 0 };
    } catch {
      return { traces: 0, mean: 0, max: 0 };
    }
  }

  /**
   * Delete T1 retrieval observations older than `before` (Unix seconds).
   * Retention only — stats are observe-only, so pruning cannot affect memory
   * energy, activation, or ranking. Returns the deleted row count.
   */
  pruneT1RetrievalEvents(opts: { before: number }): number {
    if (!Number.isFinite(opts?.before)) return 0;
    try {
      return this.db
        .prepare('DELETE FROM t1_retrieval_events WHERE created_at < ?')
        .run(opts.before).changes;
    } catch (err: any) {
      log.warn(`[T1Retrieval] prune failed: ${err?.message || err}`);
      return 0;
    }
  }

  /** Aggregate T1 retrieval observations; `since` is Unix seconds. */
  t1RetrievalStats(opts?: { since?: number }): T1RetrievalStats {
    const byKind: Record<T1RetrievalKind, number> = { search: 0, recall: 0, redeem: 0 };
    const empty: T1RetrievalStats = { total: 0, byKind, uniqueTraces: 0, lastAt: null };
    try {
      const where = Number.isFinite(opts?.since) ? 'WHERE created_at >= ?' : '';
      const params = Number.isFinite(opts?.since) ? [opts!.since] : [];
      const kinds = this.db
        .prepare(`SELECT kind, COUNT(*) AS c FROM t1_retrieval_events ${where} GROUP BY kind`)
        .all(...params) as Array<{ kind: T1RetrievalKind; c: number }>;
      for (const row of kinds) {
        if (row.kind in byKind) byKind[row.kind] = row.c;
      }
      const summary = this.db
        .prepare(
          `SELECT COUNT(*) AS total, COUNT(DISTINCT trace_id) AS uniqueTraces, MAX(created_at) AS lastAt
           FROM t1_retrieval_events ${where}`,
        )
        .get(...params) as { total: number; uniqueTraces: number; lastAt: number | null };
      return {
        total: summary.total ?? 0,
        byKind,
        uniqueTraces: summary.uniqueTraces ?? 0,
        lastAt: summary.lastAt ?? null,
      };
    } catch (err: any) {
      log.warn(`[T1Retrieval] stats failed: ${err?.message || err}`);
      return empty;
    }
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

  /** Legacy t1 pointer: archive first, then active rows for not-yet-archived turns. */
  findT1BySessionTail(tail: string, turnId: number): T1Observation[] {
    if (!tail || !Number.isInteger(turnId) || turnId < 0) return [];
    const archived = this.findArchiveBySessionTail(tail, turnId);
    if (archived.length) return archived;
    return this.db
      .prepare(`SELECT * FROM t1_observations WHERE session_id LIKE '%' || ? || '%' AND turn_id = ? ORDER BY id LIMIT 50`)
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

  /**
   * Page through T1 rows for vector backfill: archive rows first (older), then
   * active rows. Offset is a global row offset across both tables.
   */
  listT1RowsForBackfill(opts: { offset: number; limit: number }): Array<{
    observationKey: string;
    sessionId: string;
    turnId: number;
    content: string;
  }> {
    const offset = Math.max(0, Math.floor(opts.offset || 0));
    const limit = Math.max(0, Math.floor(opts.limit || 0));
    if (limit === 0) return [];
    const archiveCount = (this.db.prepare('SELECT COUNT(*) AS c FROM t1_archive').get() as { c: number }).c;
    const rows: Array<{ observationKey: string; sessionId: string; turnId: number; content: string }> = [];
    const select = (table: 't1_archive' | 't1_observations', take: number, skip: number) =>
      this.db
        .prepare(
          `SELECT observation_key AS observationKey, session_id AS sessionId,
                  turn_id AS turnId, content
           FROM ${table} WHERE observation_key IS NOT NULL
           ORDER BY id LIMIT ? OFFSET ?`,
        )
        .all(take, skip) as Array<{ observationKey: string; sessionId: string; turnId: number; content: string }>;

    if (offset < archiveCount) {
      rows.push(...select('t1_archive', Math.min(limit, archiveCount - offset), offset));
    }
    if (rows.length < limit) {
      const activeOffset = Math.max(0, offset - archiveCount);
      rows.push(...select('t1_observations', limit - rows.length, activeOffset));
    }
    return rows;
  }

  deleteSession(session_id: string): number {
    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM t1_fts WHERE observation_key IN
             (SELECT observation_key FROM t1_observations WHERE session_id = ?)`,
        )
        .run(session_id);
      return this.db.prepare('DELETE FROM t1_observations WHERE session_id = ?').run(session_id).changes;
    });
    return txn();
  }

  /**
   * Rebuild the lexical derivative from active + archive rows. Idempotent:
   * clears the FTS table first, so a crashed or partial rebuild cannot
   * duplicate rows. Returns the number of indexed rows (0 on failure).
   */
  rebuildT1Fts(): number {
    try {
      const txn = this.db.transaction(() => {
        this.db.prepare('DELETE FROM t1_fts').run();
        const active = this.db
          .prepare(
            `INSERT INTO t1_fts (content, trace_id, observation_key, session_id, turn_id, source)
             SELECT content, trace_id, observation_key, session_id, turn_id, source
             FROM t1_observations WHERE observation_key IS NOT NULL`,
          )
          .run().changes;
        const archived = this.db
          .prepare(
            `INSERT INTO t1_fts (content, trace_id, observation_key, session_id, turn_id, source)
             SELECT content, trace_id, observation_key, session_id, turn_id, source
             FROM t1_archive WHERE observation_key IS NOT NULL`,
          )
          .run().changes;
        return active + archived;
      });
      return txn();
    } catch (err: any) {
      log.warn(`[T1FTS] rebuild failed: ${err?.message || err}`);
      return 0;
    }
  }

  private rebuildT1FtsIfEmpty(): void {
    try {
      const indexed = (this.db.prepare('SELECT COUNT(*) AS c FROM t1_fts').get() as { c: number }).c;
      if (indexed > 0) return;
      const rows = (
        this.db
          .prepare(
            `SELECT (SELECT COUNT(*) FROM t1_observations) + (SELECT COUNT(*) FROM t1_archive) AS c`,
          )
          .get() as { c: number }
      ).c;
      if (rows === 0) return;
      const count = this.rebuildT1Fts();
      log.info(`[T1FTS] rebuilt ${count} row(s) into the lexical index`);
    } catch (err: any) {
      log.warn(`[T1FTS] startup rebuild skipped: ${err?.message || err}`);
    }
  }

  /**
   * Lexical T1 search over the FTS5 trigram index. Returns the best-ranked
   * row per trace. Fail-open: malformed input or an FTS error returns [].
   */
  searchT1Lexical(query: string, topK: number): T1LexicalHit[] {
    const match = buildT1FtsQuery(query);
    if (!match || !Number.isFinite(topK) || topK <= 0) return [];
    try {
      const rows = this.db
        .prepare(
          `SELECT trace_id, session_id, turn_id, source,
                  snippet(t1_fts, 0, '', '', '…', 32) AS excerpt,
                  bm25(t1_fts) AS rank
           FROM t1_fts
           WHERE t1_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(match, Math.max(topK * 4, 12)) as Array<{
        trace_id: string;
        session_id: string;
        turn_id: number;
        source: string;
        excerpt: string;
        rank: number;
      }>;
      const seen = new Set<string>();
      const hits: T1LexicalHit[] = [];
      for (const row of rows) {
        if (!row.trace_id || seen.has(row.trace_id)) continue;
        seen.add(row.trace_id);
        hits.push({
          traceId: row.trace_id,
          sessionId: row.session_id,
          turnId: row.turn_id,
          source: row.source,
          excerpt: row.excerpt || '',
          rank: row.rank,
        });
        if (hits.length >= topK) break;
      }
      return hits;
    } catch (err: any) {
      log.warn(`[T1FTS] search failed: ${err?.message || err}`);
      return [];
    }
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
    /** Goal revision；缺省 1（legacy 调用方零迁移）。 */
    revision?: number;
  }): number {
    const info = this.db.prepare(`
      INSERT INTO goal_node_runs (goal_id, project_id, loop, revision, node, attempt, session_id, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
    `).run(
      input.goalId, input.projectId, input.loop, input.revision ?? 1, input.node,
      input.attempt, input.sessionId, input.startedAt,
    );
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

  /**
   * 同 (goal, revision, loop, node) 的最新一次 attempt。
   *
   * revision 必填（I-1）：旧的三参隐式形态会静默钉在 revision 1，打回后的
   * revision 2 永远算错 attempt。三参调用在运行时直接抛错（未类型化调用方）
   * 并在类型层编译失败（TS 已无三参重载）。
   */
  latestNodeAttempt(goalId: string, revision: number, loop: number, node: string): NodeRunRow | null {
    if (node === undefined) {
      throw new TypeError(
        'latestNodeAttempt requires (goalId, revision, loop, node); pass revision 1 for legacy callers',
      );
    }
    const row = this.db.prepare(
      'SELECT * FROM goal_node_runs WHERE goal_id = ? AND revision = ? AND loop = ? AND node = ? ORDER BY id DESC LIMIT 1',
    ).get(goalId, revision, loop, node) as NodeRunRow | undefined;
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
