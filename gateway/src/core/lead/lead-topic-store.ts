import type { Database } from 'better-sqlite3';

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
}

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
  };
}

/**
 * Handoff provenance only: a row is written when a Lead topic is handed to a
 * Goal. Not a general topic table (no open/closed state machine).
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
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_topic_project_created
        ON lead_topic(project_dir, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lead_topic_goal ON lead_topic(goal_id);
    `);
  }

  insert(row: LeadTopicRow): void {
    this.db.prepare(`
      INSERT INTO lead_topic (
        id, project_dir, lead_session_id, title, start_message_id,
        end_message_id, goal_id, owner_role, owner_session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );
  }

  latestForProject(projectDir: string): LeadTopicRow | null {
    const row = this.db.prepare(`
      SELECT * FROM lead_topic WHERE project_dir = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(projectDir) as LeadTopicDbRow | undefined;
    return row ? toRow(row) : null;
  }

  listByProject(projectDir: string): LeadTopicRow[] {
    const rows = this.db.prepare(`
      SELECT * FROM lead_topic WHERE project_dir = ? ORDER BY created_at DESC, id DESC
    `).all(projectDir) as LeadTopicDbRow[];
    return rows.map(toRow);
  }

  get(id: string): LeadTopicRow | null {
    const row = this.db.prepare('SELECT * FROM lead_topic WHERE id = ?').get(id) as LeadTopicDbRow | undefined;
    return row ? toRow(row) : null;
  }
}
