// gateway/src/core/goal/goal-state-store.ts
// SQLite is the GoalState write authority (Phase 2). The JSON file stays as a
// best-effort mirror: a mirror failure never blocks a state transition, and a
// missing DB row lazily imports the legacy file on first read.
import type Database from 'better-sqlite3';
import {
  archiveGoalStateFile,
  loadGoalStateFile,
  normalizeRevision,
  saveGoalStateFile,
} from './goal-state-file';
import {
  normalizeGoalState,
  type GoalStateV3,
  type GoalStateV3 as GoalState,
} from './state-v3';

export interface GoalStateBackend {
  load(mafwDir: string, goalId: string): GoalStateV3 | null;
  save(mafwDir: string, goalId: string, state: GoalStateV3): void;
  archiveRevision(mafwDir: string, goalId: string, revision: number): void;
  list(): GoalStateV3[];
}

interface GoalStateDbRow {
  goal_id: string;
  revision: number;
  phase: string | null;
  next_action: string;
  state_json: string;
  updated_at: string;
}

export class GoalStateStore implements GoalStateBackend {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal_state (
        goal_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        phase TEXT,
        next_action TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goal_state_revisions (
        goal_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        PRIMARY KEY (goal_id, revision)
      );
    `);
  }

  private parse(row: GoalStateDbRow): GoalState | null {
    try {
      const raw = JSON.parse(row.state_json);
      if (!raw || typeof raw !== 'object') return null;
      return normalizeGoalState(raw, raw.mafwDir ?? '', row.goal_id);
    } catch {
      return null;
    }
  }

  load(mafwDir: string, goalId: string): GoalStateV3 | null {
    const row = this.db.prepare('SELECT * FROM goal_state WHERE goal_id = ?')
      .get(goalId) as GoalStateDbRow | undefined;
    if (row) {
      const parsed = this.parse(row);
      if (parsed) return parsed;
    }

    const legacy = loadGoalStateFile(mafwDir, goalId);
    if (!legacy) return null;
    this.save(mafwDir, goalId, legacy);
    return legacy;
  }

  save(mafwDir: string, goalId: string, state: GoalStateV3): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO goal_state (goal_id, revision, phase, next_action, state_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(goal_id) DO UPDATE SET
        revision = excluded.revision,
        phase = excluded.phase,
        next_action = excluded.next_action,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(
      goalId,
      normalizeRevision(state.revision),
      state.phase ?? null,
      state.nextAction,
      JSON.stringify(state),
      now,
    );

    try {
      saveGoalStateFile(mafwDir, goalId, state);
    } catch (error: any) {
      // Mirror only: the SQLite row is authoritative.
      console.warn(`[GoalState] json mirror failed for ${goalId}: ${error?.message ?? error}`);
    }
  }

  archiveRevision(mafwDir: string, goalId: string, revision: number): void {
    const current = this.load(mafwDir, goalId);
    const target = normalizeRevision(revision);
    if (!current) return;

    const snapshot: GoalStateV3 = { ...current, revision: target };
    this.db.prepare(`
      INSERT OR IGNORE INTO goal_state_revisions (goal_id, revision, state_json, archived_at)
      VALUES (?, ?, ?, ?)
    `).run(goalId, target, JSON.stringify(snapshot), new Date().toISOString());

    try {
      archiveGoalStateFile(mafwDir, goalId, target);
    } catch (error: any) {
      console.warn(`[GoalState] revision mirror failed for ${goalId}#${target}: ${error?.message ?? error}`);
    }
  }

  list(): GoalStateV3[] {
    const rows = this.db.prepare('SELECT * FROM goal_state ORDER BY updated_at ASC')
      .all() as GoalStateDbRow[];
    const out: GoalStateV3[] = [];
    for (const row of rows) {
      const parsed = this.parse(row);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  /** Test/debug helper: archived revision rows for one goal. */
  listRevisions(goalId: string): Array<{ revision: number; archivedAt: string }> {
    const rows = this.db.prepare(
      'SELECT revision, archived_at FROM goal_state_revisions WHERE goal_id = ? ORDER BY revision ASC',
    ).all(goalId) as Array<{ revision: number; archived_at: string }>;
    return rows.map((row) => ({ revision: row.revision, archivedAt: row.archived_at }));
  }
}
