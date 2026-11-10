import type { Database } from 'better-sqlite3';

export type LeadTopicState = 'resident' | 'warm' | 'cold' | 'archived';

export interface LeadTopicRow {
  id: string;
  projectDir: string;
  leadSessionId: string;
  title: string;
  startMessageId: string;
  endMessageId: string;
  goalId: string;
  ownerRole: 'lead' | 'tech-lead';
  ownerSessionId: string | null;
  createdAt: string;
  /** Working-set summary (decisions / open loops / user words). */
  summary: string | null;
  summaryHash: string | null;
  summaryUpdatedAt: string | null;
  state: LeadTopicState;
  lastActiveAt: string;
  residentTokens: number;
  resumedFrom: string | null;
  /** P2 COW fork provenance (null for ordinary topics). */
  forkedFrom?: string | null;
  forkedAt?: string | null;
  inheritedMessageRange?: { from: string; to: string } | null;
}

type LeadTopicInsert = Omit<
  LeadTopicRow,
  'summary' | 'summaryHash' | 'summaryUpdatedAt' | 'state' | 'lastActiveAt' | 'residentTokens' | 'resumedFrom'
  | 'forkedFrom' | 'forkedAt' | 'inheritedMessageRange'
> & Partial<Pick<
  LeadTopicRow,
  'summary' | 'summaryHash' | 'summaryUpdatedAt' | 'state' | 'lastActiveAt' | 'residentTokens' | 'resumedFrom'
  | 'forkedFrom' | 'forkedAt' | 'inheritedMessageRange'
>>;

interface LeadTopicDbRow {
  id: string;
  project_dir: string;
  lead_session_id: string;
  title: string;
  start_message_id: string;
  end_message_id: string;
  goal_id: string;
  owner_role: string;
  owner_session_id: string | null;
  created_at: string;
  summary?: string | null;
  summary_hash?: string | null;
  summary_updated_at?: string | null;
  state?: string | null;
  last_active_at?: string | null;
  resident_tokens?: number | null;
  resumed_from?: string | null;
  forked_from?: string | null;
  forked_at?: string | null;
  inherited_message_range?: string | null;
}

function normalizeState(value: unknown): LeadTopicState {
  return value === 'resident' || value === 'cold' || value === 'archived' ? value : 'warm';
}

function parseRange(value: unknown): { from: string; to: string } | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed.from === 'string' && typeof parsed.to === 'string') {
      return { from: parsed.from, to: parsed.to };
    }
  } catch { /* ignore */ }
  return null;
}

function toRow(row: LeadTopicDbRow): LeadTopicRow {
  return {
    id: row.id,
    projectDir: row.project_dir,
    leadSessionId: row.lead_session_id,
    title: row.title,
    startMessageId: row.start_message_id,
    endMessageId: row.end_message_id,
    goalId: row.goal_id,
    ownerRole: row.owner_role === 'lead' ? 'lead' : 'tech-lead',
    ownerSessionId: row.owner_session_id,
    createdAt: row.created_at,
    summary: row.summary ?? null,
    summaryHash: row.summary_hash ?? null,
    summaryUpdatedAt: row.summary_updated_at ?? null,
    state: normalizeState(row.state),
    lastActiveAt: row.last_active_at ?? row.created_at,
    residentTokens: Number(row.resident_tokens ?? 0),
    resumedFrom: row.resumed_from ?? null,
    forkedFrom: row.forked_from ?? null,
    forkedAt: row.forked_at ?? null,
    inheritedMessageRange: parseRange(row.inherited_message_range),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Handoff provenance and working-set metadata. A row is written when a Lead
 * topic is handed to a Goal (or resumed); the summary/state columns are filled
 * by the P1 working-set pipeline.
 */
export class LeadTopicStore {
  constructor(private readonly db: Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lead_topic (
        id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL,
        lead_session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start_message_id TEXT NOT NULL,
        end_message_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        owner_role TEXT NOT NULL,
        owner_session_id TEXT,
        created_at TEXT NOT NULL,
        summary TEXT,
        summary_hash TEXT,
        summary_updated_at TEXT,
        state TEXT NOT NULL DEFAULT 'warm',
        last_active_at TEXT,
        resident_tokens INTEGER NOT NULL DEFAULT 0,
        resumed_from TEXT,
        forked_from TEXT,
        forked_at TEXT,
        inherited_message_range TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lead_topic_project_created
        ON lead_topic(project_dir, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lead_topic_goal ON lead_topic(goal_id);
    `);
    this.ensureColumn('summary', 'summary TEXT');
    this.ensureColumn('summary_hash', 'summary_hash TEXT');
    this.ensureColumn('summary_updated_at', 'summary_updated_at TEXT');
    this.ensureColumn('state', "state TEXT NOT NULL DEFAULT 'warm'");
    this.ensureColumn('last_active_at', 'last_active_at TEXT');
    this.ensureColumn('resident_tokens', 'resident_tokens INTEGER NOT NULL DEFAULT 0');
    this.ensureColumn('resumed_from', 'resumed_from TEXT');
    this.ensureColumn('forked_from', 'forked_from TEXT');
    this.ensureColumn('forked_at', 'forked_at TEXT');
    this.ensureColumn('inherited_message_range', 'inherited_message_range TEXT');
    this.db.exec('UPDATE lead_topic SET last_active_at = created_at WHERE last_active_at IS NULL');
  }

  private ensureColumn(column: string, ddl: string): void {
    const columns = this.db.prepare('PRAGMA table_info(lead_topic)').all() as Array<{ name: string }>;
    if (columns.some((entry) => entry.name === column)) return;
    this.db.exec(`ALTER TABLE lead_topic ADD COLUMN ${ddl}`);
  }

  insert(row: LeadTopicInsert): void {
    this.db.prepare(`
      INSERT INTO lead_topic (
        id, project_dir, lead_session_id, title, start_message_id,
        end_message_id, goal_id, owner_role, owner_session_id, created_at,
        summary, summary_hash, summary_updated_at, state, last_active_at,
        resident_tokens, resumed_from, forked_from, forked_at, inherited_message_range
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.projectDir,
      row.leadSessionId,
      row.title,
      row.startMessageId,
      row.endMessageId,
      row.goalId,
      row.ownerRole,
      row.ownerSessionId,
      row.createdAt,
      row.summary ?? null,
      row.summaryHash ?? null,
      row.summaryUpdatedAt ?? null,
      row.state ?? 'warm',
      row.lastActiveAt ?? row.createdAt,
      row.residentTokens ?? 0,
      row.resumedFrom ?? null,
      row.forkedFrom ?? null,
      row.forkedAt ?? null,
      row.inheritedMessageRange ? JSON.stringify(row.inheritedMessageRange) : null,
    );
  }

  latestForProject(projectDir: string): LeadTopicRow | null {
    const row = this.db.prepare(`
      SELECT * FROM lead_topic WHERE project_dir = ?
      ORDER BY last_active_at DESC, created_at DESC, id DESC LIMIT 1
    `).get(projectDir) as LeadTopicDbRow | undefined;
    return row ? toRow(row) : null;
  }

  listByProject(projectDir: string, limit?: number): LeadTopicRow[] {
    const sql = `
      SELECT * FROM lead_topic WHERE project_dir = ?
      ORDER BY last_active_at DESC, created_at DESC, id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `;
    const rows = (limit === undefined
      ? this.db.prepare(sql).all(projectDir)
      : this.db.prepare(sql).all(projectDir, Math.max(0, Math.trunc(limit)))) as LeadTopicDbRow[];
    return rows.map(toRow);
  }

  search(projectDir: string, query: string, limit?: number): LeadTopicRow[] {
    const cleaned = query.trim();
    if (!cleaned) return this.listByProject(projectDir, limit);
    const pattern = `%${escapeLike(cleaned)}%`;
    const sql = `
      SELECT * FROM lead_topic
      WHERE project_dir = ? AND (title LIKE ? ESCAPE '\\' OR COALESCE(summary, '') LIKE ? ESCAPE '\\')
      ORDER BY last_active_at DESC, created_at DESC, id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `;
    const rows = (limit === undefined
      ? this.db.prepare(sql).all(projectDir, pattern, pattern)
      : this.db.prepare(sql).all(projectDir, pattern, pattern, Math.max(0, Math.trunc(limit)))) as LeadTopicDbRow[];
    return rows.map(toRow);
  }

  get(id: string): LeadTopicRow | null {
    const row = this.db.prepare('SELECT * FROM lead_topic WHERE id = ?').get(id) as LeadTopicDbRow | undefined;
    return row ? toRow(row) : null;
  }

  findByGoal(goalId: string): LeadTopicRow | null {
    const row = this.db.prepare(`
      SELECT * FROM lead_topic WHERE goal_id = ?
      ORDER BY last_active_at DESC, created_at DESC, id DESC LIMIT 1
    `).get(goalId) as LeadTopicDbRow | undefined;
    return row ? toRow(row) : null;
  }

  updateSummary(id: string, input: {
    summary: string;
    summaryHash: string;
    now: string;
    residentTokens: number;
  }): void {
    this.db.prepare(`
      UPDATE lead_topic SET
        summary = ?,
        summary_hash = ?,
        summary_updated_at = ?,
        resident_tokens = ?,
        last_active_at = ?
      WHERE id = ?
    `).run(
      input.summary,
      input.summaryHash,
      input.now,
      Math.max(0, Math.trunc(input.residentTokens)),
      input.now,
      id,
    );
  }

  setState(id: string, state: LeadTopicState, _now: string): void {
    this.db.prepare('UPDATE lead_topic SET state = ? WHERE id = ?').run(state, id);
  }

  /** Activity touch (resume target / explicit access); separate from state changes. */
  touch(id: string, now: string): void {
    this.db.prepare('UPDATE lead_topic SET last_active_at = ? WHERE id = ?').run(now, id);
  }

  /** Best-effort rollback when the Goal intake fails after the handoff was written. */
  remove(id: string): void {
    this.db.prepare('DELETE FROM lead_topic WHERE id = ?').run(id);
  }
}
