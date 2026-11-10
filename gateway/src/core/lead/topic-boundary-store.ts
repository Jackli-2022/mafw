import type { Database } from 'better-sqlite3';
import type { BoundaryTrigger } from './topic-boundary';

export type BoundaryStatus = 'proposed' | 'accepted' | 'merged' | 'split' | 'undone';

export interface TopicBoundaryRow {
  id: string;
  projectDir: string;
  leadSessionId: string;
  fromTopicId: string;
  toTopicId: string | null;
  trigger: BoundaryTrigger;
  confidence: number;
  status: BoundaryStatus;
  /** Triggering user text (used to title the split topic). */
  text: string;
  createdAt: string;
}

interface TopicBoundaryDbRow {
  id: string;
  project_dir: string;
  lead_session_id: string;
  from_topic_id: string;
  to_topic_id: string | null;
  trigger: string;
  confidence: number;
  status: string;
  text: string | null;
  created_at: string;
}

function toRow(row: TopicBoundaryDbRow): TopicBoundaryRow {
  return {
    id: row.id,
    projectDir: row.project_dir,
    leadSessionId: row.lead_session_id,
    fromTopicId: row.from_topic_id,
    toTopicId: row.to_topic_id,
    trigger: row.trigger as BoundaryTrigger,
    confidence: Number(row.confidence ?? 0),
    status: row.status as BoundaryStatus,
    text: row.text ?? '',
    createdAt: row.created_at,
  };
}

export class TopicBoundaryStore {
  constructor(private readonly db: Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_boundary (
        id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL,
        lead_session_id TEXT NOT NULL,
        from_topic_id TEXT NOT NULL,
        to_topic_id TEXT,
        trigger TEXT NOT NULL,
        confidence REAL NOT NULL,
        status TEXT NOT NULL,
        text TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topic_boundary_project
        ON topic_boundary(project_dir, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topic_boundary_from
        ON topic_boundary(from_topic_id, created_at DESC);
    `);
    const columns = this.db.prepare('PRAGMA table_info(topic_boundary)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'text')) {
      this.db.exec('ALTER TABLE topic_boundary ADD COLUMN text TEXT');
    }
  }

  insert(row: TopicBoundaryRow): void {
    this.db.prepare(`
      INSERT INTO topic_boundary (
        id, project_dir, lead_session_id, from_topic_id, to_topic_id,
        trigger, confidence, status, text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.projectDir,
      row.leadSessionId,
      row.fromTopicId,
      row.toTopicId,
      row.trigger,
      row.confidence,
      row.status,
      row.text,
      row.createdAt,
    );
  }

  get(id: string): TopicBoundaryRow | null {
    const row = this.db.prepare('SELECT * FROM topic_boundary WHERE id = ?')
      .get(id) as TopicBoundaryDbRow | undefined;
    return row ? toRow(row) : null;
  }

  listByTopic(topicId: string): TopicBoundaryRow[] {
    return (this.db.prepare(`
      SELECT * FROM topic_boundary WHERE from_topic_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(topicId) as TopicBoundaryDbRow[]).map(toRow);
  }

  /** Most recent proposed row for a topic/trigger, used for observe dedupe. */
  latestProposed(fromTopicId: string, since: string): TopicBoundaryRow | null {
    const row = this.db.prepare(`
      SELECT * FROM topic_boundary
      WHERE from_topic_id = ? AND status = 'proposed' AND created_at >= ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(fromTopicId, since) as TopicBoundaryDbRow | undefined;
    return row ? toRow(row) : null;
  }

  updateStatus(id: string, status: BoundaryStatus, toTopicId?: string | null): void {
    this.db.prepare(
      'UPDATE topic_boundary SET status = ?, to_topic_id = COALESCE(?, to_topic_id) WHERE id = ?',
    ).run(status, toTopicId ?? null, id);
  }
}
