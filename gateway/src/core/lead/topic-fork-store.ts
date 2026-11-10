import type { Database } from 'better-sqlite3';

export interface TopicForkRow {
  id: string;
  sourceTopicId: string;
  targetGoalId: string;
  inheritedFrom: string;
  inheritedTo: string;
  mode: string;
  createdAt: string;
}

interface TopicForkDbRow {
  id: string;
  source_topic_id: string;
  target_goal_id: string;
  inherited_from: string;
  inherited_to: string;
  mode: string;
  created_at: string;
}

function toRow(row: TopicForkDbRow): TopicForkRow {
  return {
    id: row.id,
    sourceTopicId: row.source_topic_id,
    targetGoalId: row.target_goal_id,
    inheritedFrom: row.inherited_from,
    inheritedTo: row.inherited_to,
    mode: row.mode,
    createdAt: row.created_at,
  };
}

export class TopicForkStore {
  constructor(private readonly db: Database) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_fork (
        id TEXT PRIMARY KEY,
        source_topic_id TEXT NOT NULL,
        target_goal_id TEXT NOT NULL,
        inherited_from TEXT NOT NULL,
        inherited_to TEXT NOT NULL,
        mode TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topic_fork_source ON topic_fork(source_topic_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_topic_fork_goal ON topic_fork(target_goal_id);
    `);
  }

  insert(row: TopicForkRow): void {
    this.db.prepare(`
      INSERT INTO topic_fork (
        id, source_topic_id, target_goal_id, inherited_from, inherited_to, mode, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id,
      row.sourceTopicId,
      row.targetGoalId,
      row.inheritedFrom,
      row.inheritedTo,
      row.mode,
      row.createdAt,
    );
  }

  listBySource(sourceTopicId: string): TopicForkRow[] {
    return (this.db.prepare(`
      SELECT * FROM topic_fork WHERE source_topic_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(sourceTopicId) as TopicForkDbRow[]).map(toRow);
  }

  getByGoal(goalId: string): TopicForkRow | null {
    const row = this.db.prepare(
      'SELECT * FROM topic_fork WHERE target_goal_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    ).get(goalId) as TopicForkDbRow | undefined;
    return row ? toRow(row) : null;
  }
}
