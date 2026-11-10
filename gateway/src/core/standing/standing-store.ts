import type { Database } from 'better-sqlite3';
import type {
  GoalRun,
  StandingGoal,
  StandingRunMode,
  StandingRunStatus,
  StandingState,
  StandingTriggerType,
} from './standing-types';

interface GoalDbRow {
  id: string;
  project_dir: string;
  title: string;
  objective: string;
  template: string | null;
  triggers: string | null;
  state: string;
  concurrency: number;
  cooldown_ms: number;
  budget: string | null;
  approval: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface RunDbRow {
  id: string;
  standing_goal_id: string;
  trigger_type: string;
  trigger_key: string;
  payload: string | null;
  status: string;
  mode: string | null;
  rationale: string | null;
  goal_id: string | null;
  session_id: string | null;
  worktree: string | null;
  result: string | null;
  cost_usd: number | null;
  tokens: number | null;
  started_at: string | null;
  ended_at: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toGoal(row: GoalDbRow): StandingGoal {
  return {
    id: row.id,
    projectDir: row.project_dir,
    title: row.title,
    objective: row.objective,
    template: parseJson(row.template, {}),
    triggers: parseJson(row.triggers, []),
    state: row.state as StandingState,
    concurrency: Number(row.concurrency ?? 1),
    cooldownMs: Number(row.cooldown_ms ?? 0),
    budget: parseJson(row.budget, {}),
    approval: row.approval as StandingGoal['approval'],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
  };
}

function toRun(row: RunDbRow): GoalRun {
  return {
    id: row.id,
    standingGoalId: row.standing_goal_id,
    triggerType: row.trigger_type as StandingTriggerType,
    triggerKey: row.trigger_key,
    payload: parseJson(row.payload, {}),
    status: row.status as StandingRunStatus,
    mode: row.mode as StandingRunMode | null,
    rationale: row.rationale,
    goalId: row.goal_id,
    sessionId: row.session_id,
    worktree: row.worktree,
    result: parseJson(row.result, null),
    costUsd: row.cost_usd,
    tokens: row.tokens,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

export function ensureStandingSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS standing_goals (
      id TEXT PRIMARY KEY,
      project_dir TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT '{}',
      triggers TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'active',
      concurrency INTEGER NOT NULL DEFAULT 1,
      cooldown_ms INTEGER NOT NULL DEFAULT 0,
      budget TEXT NOT NULL DEFAULT '{}',
      approval TEXT NOT NULL DEFAULT 'plan',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_standing_goals_project ON standing_goals(project_dir, created_at DESC);

    CREATE TABLE IF NOT EXISTS goal_runs (
      id TEXT PRIMARY KEY,
      standing_goal_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      mode TEXT,
      rationale TEXT,
      goal_id TEXT,
      session_id TEXT,
      worktree TEXT,
      result TEXT,
      cost_usd REAL,
      tokens INTEGER,
      created_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_goal_runs_goal ON goal_runs(standing_goal_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_goal_runs_status ON goal_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS goal_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_goal_run_events_run ON goal_run_events(run_id, created_at ASC);
  `);
}

export class StandingGoalStore {
  constructor(private readonly db: Database) {
    ensureStandingSchema(db);
  }

  insertGoal(
    input: Omit<StandingGoal, 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'> & { now: string },
  ): StandingGoal {
    this.db.prepare(`
      INSERT INTO standing_goals (
        id, project_dir, title, objective, template, triggers, state,
        concurrency, cooldown_ms, budget, approval, created_by,
        created_at, updated_at, last_run_at, next_run_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      input.id,
      input.projectDir,
      input.title,
      input.objective,
      JSON.stringify(input.template ?? {}),
      JSON.stringify(input.triggers ?? []),
      input.state,
      input.concurrency,
      input.cooldownMs,
      JSON.stringify(input.budget ?? {}),
      input.approval,
      input.createdBy,
      input.now,
      input.now,
    );
    return this.getGoal(input.id)!;
  }

  getGoal(id: string): StandingGoal | null {
    const row = this.db.prepare('SELECT * FROM standing_goals WHERE id = ?').get(id) as GoalDbRow | undefined;
    return row ? toGoal(row) : null;
  }

  listGoals(projectDir: string): StandingGoal[] {
    return (this.db.prepare(
      'SELECT * FROM standing_goals WHERE project_dir = ? ORDER BY created_at DESC, id DESC',
    ).all(projectDir) as GoalDbRow[]).map(toGoal);
  }

  updateGoal(
    id: string,
    patch: Partial<Pick<StandingGoal, 'title' | 'objective' | 'template' | 'triggers' | 'concurrency' | 'cooldownMs' | 'budget' | 'approval' | 'nextRunAt'>>,
    now: string,
  ): StandingGoal {
    const current = this.getGoal(id);
    if (!current) throw new Error(`standing goal not found: ${id}`);
    const next = { ...current, ...patch };
    this.db.prepare(`
      UPDATE standing_goals SET
        title = ?, objective = ?, template = ?, triggers = ?, concurrency = ?, cooldown_ms = ?,
        budget = ?, approval = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title,
      next.objective,
      JSON.stringify(next.template ?? {}),
      JSON.stringify(next.triggers ?? []),
      next.concurrency,
      next.cooldownMs,
      JSON.stringify(next.budget ?? {}),
      next.approval,
      next.nextRunAt,
      now,
      id,
    );
    return this.getGoal(id)!;
  }

  setGoalState(id: string, state: StandingState, now: string): StandingGoal {
    this.db.prepare(
      'UPDATE standing_goals SET state = ?, updated_at = ? WHERE id = ?',
    ).run(state, now, id);
    return this.getGoal(id)!;
  }

  insertRun(
    input: Omit<GoalRun, 'startedAt' | 'endedAt'> & { now: string },
  ): GoalRun {
    this.db.prepare(`
      INSERT INTO goal_runs (
        id, standing_goal_id, trigger_type, trigger_key, payload, status, mode, rationale,
        goal_id, session_id, worktree, result, cost_usd, tokens, created_at, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      input.id,
      input.standingGoalId,
      input.triggerType,
      input.triggerKey,
      JSON.stringify(input.payload ?? {}),
      input.status,
      input.mode,
      input.rationale,
      input.goalId,
      input.sessionId,
      input.worktree,
      input.result ? JSON.stringify(input.result) : null,
      input.costUsd,
      input.tokens,
      input.now,
    );
    return this.getRun(input.id)!;
  }

  getRun(id: string): GoalRun | null {
    const row = this.db.prepare('SELECT * FROM goal_runs WHERE id = ?').get(id) as RunDbRow | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(standingGoalId: string, limit = 50): GoalRun[] {
    return (this.db.prepare(
      'SELECT * FROM goal_runs WHERE standing_goal_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(standingGoalId, Math.max(1, Math.trunc(limit))) as RunDbRow[]).map(toRun);
  }

  updateRun(
    id: string,
    patch: Partial<Pick<GoalRun, 'status' | 'mode' | 'rationale' | 'goalId' | 'sessionId' | 'worktree' | 'result' | 'costUsd' | 'tokens' | 'startedAt' | 'endedAt'>>,
  ): GoalRun {
    const current = this.getRun(id);
    if (!current) throw new Error(`goal run not found: ${id}`);
    const next = { ...current, ...patch };
    this.db.prepare(`
      UPDATE goal_runs SET
        status = ?, mode = ?, rationale = ?, goal_id = ?, session_id = ?, worktree = ?,
        result = ?, cost_usd = ?, tokens = ?, started_at = ?, ended_at = ?
      WHERE id = ?
    `).run(
      next.status,
      next.mode,
      next.rationale,
      next.goalId,
      next.sessionId,
      next.worktree,
      next.result ? JSON.stringify(next.result) : null,
      next.costUsd,
      next.tokens,
      next.startedAt,
      next.endedAt,
      id,
    );
    return this.getRun(id)!;
  }

  findRunByTriggerKey(standingGoalId: string, triggerKey: string): GoalRun | null {
    const row = this.db.prepare(
      'SELECT * FROM goal_runs WHERE standing_goal_id = ? AND trigger_key = ?',
    ).get(standingGoalId, triggerKey) as RunDbRow | undefined;
    return row ? toRun(row) : null;
  }

  findRunByGoalId(goalId: string): GoalRun | null {
    const row = this.db.prepare(
      'SELECT * FROM goal_runs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(goalId) as RunDbRow | undefined;
    return row ? toRun(row) : null;
  }

  listRunsForDay(projectDir: string, dayStartIso: string): GoalRun[] {
    return (this.db.prepare(`
      SELECT r.* FROM goal_runs r
      JOIN standing_goals g ON g.id = r.standing_goal_id
      WHERE g.project_dir = ? AND r.created_at >= ?
      ORDER BY r.created_at ASC
    `).all(projectDir, dayStartIso) as RunDbRow[]).map(toRun);
  }

  appendRunEvent(runId: string, type: string, payload: Record<string, unknown>, now: string): void {
    this.db.prepare(
      'INSERT INTO goal_run_events (run_id, type, payload, created_at) VALUES (?, ?, ?, ?)',
    ).run(runId, type, JSON.stringify(payload ?? {}), now);
  }
}
