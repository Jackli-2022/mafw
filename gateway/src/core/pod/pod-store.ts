import type { Database } from 'better-sqlite3';

export type PodStatus = 'active' | 'idle' | 'paused' | 'archived';
export type PodMemberRole = 'lead' | 'builder' | 'reviewer' | 'curator';
export type PodMemberStatus = 'available' | 'working' | 'waiting' | 'sleeping' | 'retired';
export type PodGoalStatus = 'queued' | 'active' | 'done' | 'aborted';
export type PodTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'failed'
  | 'reopened';

export interface PodRow {
  id: string;
  projectDir: string;
  name: string;
  status: PodStatus;
  configJson: string;
  activeGoalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodMemberRow {
  id: string;
  podId: string;
  role: PodMemberRole;
  displayName: string;
  agentName: string;
  modelProvider: string | null;
  modelId: string | null;
  status: PodMemberStatus;
  configJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodGoalRow {
  id: string;
  podId: string;
  goalId: string;
  status: PodGoalStatus;
  enqueuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface PodTaskRow {
  id: string;
  podId: string;
  goalId: string | null;
  sourceKey: string;
  externalTaskId: string | null;
  title: string;
  description: string | null;
  ownerMemberId: string | null;
  status: PodTaskStatus;
  dependenciesJson: string | null;
  artifactRefsJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodMessageRow {
  id: string;
  podId: string;
  fromMemberId: string;
  toMemberId: string | null;
  kind: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface PodSessionRow {
  id: string;
  podId: string;
  memberId: string;
  goalId: string | null;
  node: string | null;
  sessionId: string;
  status: string;
  transcriptRef: string | null;
  createdAt: string;
  endedAt: string | null;
}

export class PodError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PodError';
  }
}

function podFromRow(row: any): PodRow {
  return {
    id: row.id,
    projectDir: row.project_dir,
    name: row.name,
    status: row.status,
    configJson: row.config_json,
    activeGoalId: row.active_goal_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memberFromRow(row: any): PodMemberRow {
  return {
    id: row.id,
    podId: row.pod_id,
    role: row.role,
    displayName: row.display_name,
    agentName: row.agent_name,
    modelProvider: row.model_provider ?? null,
    modelId: row.model_id ?? null,
    status: row.status,
    configJson: row.config_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function goalFromRow(row: any): PodGoalRow {
  return {
    id: row.id,
    podId: row.pod_id,
    goalId: row.goal_id,
    status: row.status,
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
  };
}

function taskFromRow(row: any): PodTaskRow {
  return {
    id: row.id,
    podId: row.pod_id,
    goalId: row.goal_id ?? null,
    sourceKey: row.source_key,
    externalTaskId: row.external_task_id ?? null,
    title: row.title,
    description: row.description ?? null,
    ownerMemberId: row.owner_member_id ?? null,
    status: row.status,
    dependenciesJson: row.dependencies_json ?? null,
    artifactRefsJson: row.artifact_refs_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: any): PodMessageRow {
  return {
    id: row.id,
    podId: row.pod_id,
    fromMemberId: row.from_member_id,
    toMemberId: row.to_member_id ?? null,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

function sessionFromRow(row: any): PodSessionRow {
  return {
    id: row.id,
    podId: row.pod_id,
    memberId: row.member_id,
    goalId: row.goal_id ?? null,
    node: row.node ?? null,
    sessionId: row.session_id,
    status: row.status,
    transcriptRef: row.transcript_ref ?? null,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? null,
  };
}

const ROLE_ORDER = `CASE role WHEN 'lead' THEN 0 WHEN 'builder' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END`;

export class PodStore {
  constructor(private readonly db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_pods (
        id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        active_goal_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_project_pods_status ON project_pods(status);

      CREATE TABLE IF NOT EXISTS pod_members (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        model_provider TEXT,
        model_id TEXT,
        status TEXT NOT NULL,
        config_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pod_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_members_pod ON pod_members(pod_id);

      CREATE TABLE IF NOT EXISTS pod_goals (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        UNIQUE(pod_id, goal_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_goals_goal ON pod_goals(goal_id);
      CREATE INDEX IF NOT EXISTS idx_pod_goals_pod_status ON pod_goals(pod_id, status, enqueued_at);

      CREATE TABLE IF NOT EXISTS pod_tasks (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        goal_id TEXT,
        source_key TEXT NOT NULL,
        external_task_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        owner_member_id TEXT,
        status TEXT NOT NULL,
        dependencies_json TEXT,
        artifact_refs_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(pod_id, source_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pod_tasks_pod_goal ON pod_tasks(pod_id, goal_id);

      CREATE TABLE IF NOT EXISTS pod_messages (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        from_member_id TEXT NOT NULL,
        to_member_id TEXT,
        kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pod_messages_pod ON pod_messages(pod_id, created_at);

      CREATE TABLE IF NOT EXISTS pod_member_sessions (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        goal_id TEXT,
        node TEXT,
        session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        transcript_ref TEXT,
        created_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pod_member_sessions_pod ON pod_member_sessions(pod_id, ended_at);

      CREATE TABLE IF NOT EXISTS pod_session_snapshots (
        id TEXT PRIMARY KEY,
        pod_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        goal_id TEXT,
        node TEXT,
        session_id TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pod_snapshots_pod ON pod_session_snapshots(pod_id);
    `);
  }

  ensurePod(input: { id: string; projectDir: string; name: string; configJson?: string; now: string }): PodRow {
    const row = this.db.prepare(`
      INSERT INTO project_pods (id, project_dir, name, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, 'idle', ?, ?, ?)
      ON CONFLICT(project_dir) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
      RETURNING *
    `).get(input.id, input.projectDir, input.name, input.configJson ?? '{}', input.now, input.now) as any;
    return podFromRow(row);
  }

  getPod(id: string): PodRow | null {
    const row = this.db.prepare('SELECT * FROM project_pods WHERE id = ?').get(id) as any;
    return row ? podFromRow(row) : null;
  }

  getPodByProject(projectDir: string): PodRow | null {
    const row = this.db.prepare('SELECT * FROM project_pods WHERE project_dir = ?').get(projectDir) as any;
    return row ? podFromRow(row) : null;
  }

  findPodIdByGoal(goalId: string): string | null {
    const row = this.db.prepare(
      'SELECT pod_id FROM pod_goals WHERE goal_id = ? ORDER BY enqueued_at DESC LIMIT 1',
    ).get(goalId) as { pod_id?: string } | undefined;
    return row?.pod_id ?? null;
  }

  listPods(): PodRow[] {
    return (this.db.prepare('SELECT * FROM project_pods ORDER BY created_at ASC').all() as any[]).map(podFromRow);
  }

  updatePod(
    id: string,
    patch: Partial<Pick<PodRow, 'name' | 'status' | 'configJson' | 'activeGoalId'>>,
    now: string,
  ): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); values.push(patch.name); }
    if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
    if (patch.configJson !== undefined) { sets.push('config_json = ?'); values.push(patch.configJson); }
    if (patch.activeGoalId !== undefined) { sets.push('active_goal_id = ?'); values.push(patch.activeGoalId); }
    sets.push('updated_at = ?'); values.push(now, id);
    this.db.prepare(`UPDATE project_pods SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  upsertMember(input: Omit<PodMemberRow, 'createdAt' | 'updatedAt'> & { now: string }): PodMemberRow {
    const row = this.db.prepare(`
      INSERT INTO pod_members (id, pod_id, role, display_name, agent_name, model_provider, model_id, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pod_id, role) DO UPDATE SET
        display_name = excluded.display_name,
        agent_name = excluded.agent_name,
        model_provider = excluded.model_provider,
        model_id = excluded.model_id,
        status = excluded.status,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      input.id, input.podId, input.role, input.displayName, input.agentName,
      input.modelProvider, input.modelId, input.status, input.configJson, input.now, input.now,
    ) as any;
    return memberFromRow(row);
  }

  listMembers(podId: string): PodMemberRow[] {
    return (this.db.prepare(`SELECT * FROM pod_members WHERE pod_id = ? ORDER BY ${ROLE_ORDER}`).all(podId) as any[])
      .map(memberFromRow);
  }

  getMemberByRole(podId: string, role: PodMemberRole): PodMemberRow | null {
    const row = this.db.prepare('SELECT * FROM pod_members WHERE pod_id = ? AND role = ?').get(podId, role) as any;
    return row ? memberFromRow(row) : null;
  }

  getMemberBySession(sessionId: string): PodMemberRow | null {
    const row = this.db.prepare(`
      SELECT m.* FROM pod_members m
      JOIN pod_member_sessions s ON s.member_id = m.id
      WHERE s.session_id = ?
      ORDER BY s.created_at DESC
      LIMIT 1
    `).get(sessionId) as any;
    return row ? memberFromRow(row) : null;
  }

  enqueueGoal(input: { id: string; podId: string; goalId: string; now: string }): PodGoalRow {
    const existing = this.getGoal(input.podId, input.goalId);
    if (existing) return existing;
    const row = this.db.prepare(`
      INSERT INTO pod_goals (id, pod_id, goal_id, status, enqueued_at)
      VALUES (?, ?, ?, 'queued', ?)
      RETURNING *
    `).get(input.id, input.podId, input.goalId, input.now) as any;
    return goalFromRow(row);
  }

  getGoal(podId: string, goalId: string): PodGoalRow | null {
    const row = this.db.prepare('SELECT * FROM pod_goals WHERE pod_id = ? AND goal_id = ?').get(podId, goalId) as any;
    return row ? goalFromRow(row) : null;
  }

  getGoalByGoalId(goalId: string): PodGoalRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_goals WHERE goal_id = ? ORDER BY enqueued_at DESC LIMIT 1',
    ).get(goalId) as any;
    return row ? goalFromRow(row) : null;
  }

  getActiveGoal(podId: string): PodGoalRow | null {
    const row = this.db.prepare(
      "SELECT * FROM pod_goals WHERE pod_id = ? AND status = 'active' ORDER BY started_at ASC LIMIT 1",
    ).get(podId) as any;
    return row ? goalFromRow(row) : null;
  }

  listGoals(podId: string): PodGoalRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_goals WHERE pod_id = ? ORDER BY enqueued_at ASC',
    ).all(podId) as any[]).map(goalFromRow);
  }

  setGoalStatus(
    id: string,
    status: PodGoalStatus,
    patch: { startedAt?: string; endedAt?: string },
  ): void {
    this.db.prepare(`
      UPDATE pod_goals SET
        status = ?,
        started_at = COALESCE(?, started_at),
        ended_at = COALESCE(?, ended_at)
      WHERE id = ?
    `).run(status, patch.startedAt ?? null, patch.endedAt ?? null, id);
  }

  upsertTask(input: Omit<PodTaskRow, 'createdAt' | 'updatedAt'> & { now: string }): PodTaskRow {
    const row = this.db.prepare(`
      INSERT INTO pod_tasks (
        id, pod_id, goal_id, source_key, external_task_id, title, description,
        owner_member_id, status, dependencies_json, artifact_refs_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pod_id, source_key) DO UPDATE SET
        goal_id = excluded.goal_id,
        external_task_id = excluded.external_task_id,
        title = excluded.title,
        description = excluded.description,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      input.id, input.podId, input.goalId, input.sourceKey, input.externalTaskId,
      input.title, input.description, input.ownerMemberId, input.status,
      input.dependenciesJson, input.artifactRefsJson, input.now, input.now,
    ) as any;
    return taskFromRow(row);
  }

  getTask(id: string): PodTaskRow | null {
    const row = this.db.prepare('SELECT * FROM pod_tasks WHERE id = ?').get(id) as any;
    return row ? taskFromRow(row) : null;
  }

  getTaskBySourceKey(podId: string, sourceKey: string): PodTaskRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_tasks WHERE pod_id = ? AND source_key = ?',
    ).get(podId, sourceKey) as any;
    return row ? taskFromRow(row) : null;
  }

  listTasks(podId: string, goalId?: string): PodTaskRow[] {
    const rows = goalId
      ? this.db.prepare('SELECT * FROM pod_tasks WHERE pod_id = ? AND goal_id = ? ORDER BY created_at ASC').all(podId, goalId)
      : this.db.prepare('SELECT * FROM pod_tasks WHERE pod_id = ? ORDER BY created_at ASC').all(podId);
    return (rows as any[]).map(taskFromRow);
  }

  updateTask(
    id: string,
    patch: Partial<Pick<PodTaskRow, 'title' | 'description' | 'ownerMemberId' | 'status' | 'artifactRefsJson' | 'dependenciesJson'>>,
    now: string,
  ): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); values.push(patch.title); }
    if (patch.description !== undefined) { sets.push('description = ?'); values.push(patch.description); }
    if (patch.ownerMemberId !== undefined) { sets.push('owner_member_id = ?'); values.push(patch.ownerMemberId); }
    if (patch.status !== undefined) { sets.push('status = ?'); values.push(patch.status); }
    if (patch.artifactRefsJson !== undefined) { sets.push('artifact_refs_json = ?'); values.push(patch.artifactRefsJson); }
    if (patch.dependenciesJson !== undefined) { sets.push('dependencies_json = ?'); values.push(patch.dependenciesJson); }
    sets.push('updated_at = ?'); values.push(now, id);
    this.db.prepare(`UPDATE pod_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  insertMessage(input: Omit<PodMessageRow, 'createdAt' | 'readAt'> & { now: string }): PodMessageRow {
    const row = this.db.prepare(`
      INSERT INTO pod_messages (id, pod_id, from_member_id, to_member_id, kind, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.id, input.podId, input.fromMemberId, input.toMemberId,
      input.kind, input.body, input.now,
    ) as any;
    return messageFromRow(row);
  }

  listMessages(podId: string, limit = 100): PodMessageRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_messages WHERE pod_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
    ).all(podId, limit) as any[]).map(messageFromRow);
  }

  markMessageRead(id: string, now: string): void {
    this.db.prepare('UPDATE pod_messages SET read_at = ? WHERE id = ?').run(now, id);
  }

  insertSession(input: Omit<PodSessionRow, 'createdAt' | 'endedAt'> & { now: string }): PodSessionRow {
    this.db.prepare(`
      INSERT OR IGNORE INTO pod_member_sessions (
        id, pod_id, member_id, goal_id, node, session_id, status, transcript_ref, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.podId, input.memberId, input.goalId, input.node,
      input.sessionId, input.status, input.transcriptRef, input.now,
    );
    const row = this.db.prepare('SELECT * FROM pod_member_sessions WHERE session_id = ?').get(input.sessionId) as any;
    return sessionFromRow(row);
  }

  listSessions(podId: string): PodSessionRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE pod_id = ? ORDER BY created_at DESC',
    ).all(podId) as any[]).map(sessionFromRow);
  }

  getSessionBySessionId(sessionId: string): PodSessionRow | null {
    const row = this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE session_id = ?',
    ).get(sessionId) as any;
    return row ? sessionFromRow(row) : null;
  }

  listActiveSessions(podId: string): PodSessionRow[] {
    return (this.db.prepare(
      'SELECT * FROM pod_member_sessions WHERE pod_id = ? AND ended_at IS NULL ORDER BY created_at DESC',
    ).all(podId) as any[]).map(sessionFromRow);
  }

  endSession(sessionId: string, now: string): void {
    this.db.prepare(
      "UPDATE pod_member_sessions SET ended_at = ?, status = 'ended' WHERE session_id = ?",
    ).run(now, sessionId);
  }

  insertSnapshot(input: {
    id: string; podId: string; memberId: string; goalId: string | null;
    node: string | null; sessionId: string; path: string; now: string;
  }): void {
    this.db.prepare(`
      INSERT INTO pod_session_snapshots (id, pod_id, member_id, goal_id, node, session_id, path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET path = excluded.path, created_at = excluded.created_at
    `).run(
      input.id, input.podId, input.memberId, input.goalId, input.node,
      input.sessionId, input.path, input.now,
    );
  }

  getSnapshot(sessionId: string): { path: string } | null {
    const row = this.db.prepare(
      'SELECT path FROM pod_session_snapshots WHERE session_id = ?',
    ).get(sessionId) as { path?: string } | undefined;
    return row?.path ? { path: row.path } : null;
  }

  listSessionIds(podId: string, sinceEpoch: number): string[] {
    const since = new Date(sinceEpoch * 1000).toISOString();
    return (this.db.prepare(
      'SELECT DISTINCT session_id FROM pod_member_sessions WHERE pod_id = ? AND created_at >= ? ORDER BY session_id',
    ).all(podId, since) as Array<{ session_id: string }>).map((r) => r.session_id);
  }
}
