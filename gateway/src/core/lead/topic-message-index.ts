import type { Database } from 'better-sqlite3';

export interface TopicMessageIndexRow {
  topicId: string;
  messageId: string;
  role: 'user' | 'assistant';
  text: string;
  tokenEstimate: number;
  createdAt: string;
}

interface TopicMessageIndexDbRow {
  topic_id: string;
  message_id: string;
  role: string;
  text: string;
  token_estimate: number;
  created_at: string;
}

function toRow(row: TopicMessageIndexDbRow): TopicMessageIndexRow {
  return {
    topicId: row.topic_id,
    messageId: row.message_id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.text,
    tokenEstimate: Number(row.token_estimate ?? 0),
    createdAt: row.created_at,
  };
}

/**
 * Searchable index of the messages that were swapped out of the Lead resident
 * context. Rows mirror (never replace) the original transcript.
 */
export class TopicMessageIndexStore {
  constructor(private readonly db: Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_message_index (
        topic_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        token_estimate INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY(topic_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_topic_message_created
        ON topic_message_index(topic_id, created_at DESC);
    `);
  }

  /** Atomically swap a topic's index rows (idempotent re-index). */
  replaceTopic(topicId: string, rows: TopicMessageIndexRow[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO topic_message_index (
        topic_id, message_id, role, text, token_estimate, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    const run = this.db.transaction((items: TopicMessageIndexRow[]) => {
      this.db.prepare('DELETE FROM topic_message_index WHERE topic_id = ?').run(topicId);
      for (const row of items) {
        insert.run(
          topicId,
          row.messageId,
          row.role,
          row.text,
          Math.max(0, Math.trunc(row.tokenEstimate)),
          row.createdAt,
        );
      }
    });
    run(rows);
  }

  listByTopic(topicId: string, limit?: number): TopicMessageIndexRow[] {
    const sql = `
      SELECT * FROM topic_message_index WHERE topic_id = ?
      ORDER BY created_at DESC, message_id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `;
    const rows = (limit === undefined
      ? this.db.prepare(sql).all(topicId)
      : this.db.prepare(sql).all(topicId, Math.max(0, Math.trunc(limit)))) as TopicMessageIndexDbRow[];
    return rows.map(toRow);
  }

  listByProject(projectDir: string, limit?: number): TopicMessageIndexRow[] {
    const sql = `
      SELECT i.* FROM topic_message_index i
      JOIN lead_topic t ON t.id = i.topic_id
      WHERE t.project_dir = ?
      ORDER BY i.created_at DESC, i.message_id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `;
    const rows = (limit === undefined
      ? this.db.prepare(sql).all(projectDir)
      : this.db.prepare(sql).all(projectDir, Math.max(0, Math.trunc(limit)))) as TopicMessageIndexDbRow[];
    return rows.map(toRow);
  }
}
