/**
 * T2-2 RunStateService —— 持久状态机（suspend/resume/reopen/finish/discard）。
 *
 * 编排（abort/settle/队列闸门/启动恢复）在 RunCoordinator；本层只做落库与
 * 状态迁移 + `run.updated` 广播。
 */
import type { RunStateRow } from '../../memory/gateway-db';
import type { ResumeBrief } from './run-brief';

export type RunStatus = 'suspended' | 'resumed' | 'completed' | 'failed' | 'cancelled';

export interface RunState {
  id: string;
  sessionID: string;
  projectDir: string;
  status: RunStatus;
  reason?: string;
  brief: ResumeBrief;
  createdAt: string;
  suspendedAt: string;
  resumedAt?: string;
  finishedAt?: string;
}

export class RunStateError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RunStateError';
  }
}

export interface RunDbDeps {
  insertRunState(row: RunStateRow): void;
  getRunState(id: string): RunStateRow | undefined;
  getActiveRunState(sessionId: string): RunStateRow | undefined;
  listActiveRunStates(): RunStateRow[];
  updateRunState(
    id: string,
    patch: Partial<Pick<RunStateRow, 'status' | 'resumed_at' | 'finished_at' | 'reason'>>,
  ): void;
  pruneRunStates(sessionId: string, keep: number): number;
  deleteRunStates(sessionId: string): void;
}

export interface RunStateServiceDeps {
  db: RunDbDeps;
  broadcast(event: { type: string; [key: string]: any }): void;
  now(): string;
  newId(): string;
  eventName?: string;
}

const KEEP = 20;
const ACTIVE = new Set<RunStatus>(['suspended', 'resumed']);

export class RunStateService {
  constructor(private deps: RunStateServiceDeps) {}

  private get eventName(): string {
    return this.deps.eventName ?? 'run.updated';
  }

  private emit(run: RunState): void {
    this.deps.broadcast({
      type: this.eventName,
      properties: { sessionID: run.sessionID, run },
      sessionID: run.sessionID,
    });
  }

  suspend(input: {
    sessionID: string;
    projectDir: string;
    brief: ResumeBrief;
    reason?: string;
  }): RunState {
    if (this.active(input.sessionID)) {
      throw new RunStateError(409, 'run already active for this session');
    }
    const now = this.deps.now();
    const row: RunStateRow = {
      id: this.deps.newId(),
      session_id: input.sessionID,
      project_dir: input.projectDir,
      status: 'suspended',
      reason: input.reason ?? null,
      brief_json: JSON.stringify(input.brief),
      created_at: now,
      suspended_at: now,
      resumed_at: null,
      finished_at: null,
    };
    this.deps.db.insertRunState(row);
    this.deps.db.pruneRunStates(input.sessionID, KEEP);
    const run = toRunDto(row);
    this.emit(run);
    return run;
  }

  resume(id: string): RunState {
    const row = this.require(id);
    if (row.status !== 'suspended') {
      throw new RunStateError(409, `run is not suspended (status=${row.status})`);
    }
    this.deps.db.updateRunState(id, { status: 'resumed', resumed_at: this.deps.now() });
    const run = toRunDto(this.deps.db.getRunState(id)!);
    this.emit(run);
    return run;
  }

  /** 恢复发送失败回滚：resumed → suspended（可再次恢复）。
   *  仅当仍处于 resumed 时生效——run 已被 discard/finish 时是 no-op（review #3）。 */
  reopen(id: string, reason?: string): RunState {
    const row = this.require(id);
    if (row.status !== 'resumed') return toRunDto(row);
    this.deps.db.updateRunState(id, {
      status: 'suspended',
      resumed_at: null,
      ...(reason ? { reason } : {}),
    });
    const run = toRunDto(this.deps.db.getRunState(id)!);
    this.emit(run);
    return run;
  }

  finish(sessionID: string, outcome: 'completed' | 'failed' | 'cancelled'): RunState | null {
    const row = this.deps.db.getActiveRunState(sessionID);
    if (!row || row.status !== 'resumed') return null;
    this.deps.db.updateRunState(row.id, { status: outcome, finished_at: this.deps.now() });
    this.deps.db.pruneRunStates(sessionID, KEEP);
    const run = toRunDto(this.deps.db.getRunState(row.id)!);
    this.emit(run);
    return run;
  }

  discard(id: string): RunState {
    const row = this.require(id);
    if (row.status === 'suspended' || row.status === 'resumed') {
      this.deps.db.updateRunState(id, { status: 'cancelled', finished_at: this.deps.now() });
      this.deps.db.pruneRunStates(row.session_id, KEEP);
    }
    const run = toRunDto(this.deps.db.getRunState(id)!);
    this.emit(run);
    return run;
  }

  active(sessionID: string): RunState | null {
    const row = this.deps.db.getActiveRunState(sessionID);
    return row ? toRunDto(row) : null;
  }

  listActive(): RunState[] {
    return this.deps.db.listActiveRunStates().map(toRunDto);
  }

  deleteForSession(sessionID: string): void {
    this.deps.db.deleteRunStates(sessionID);
  }

  private require(id: string): RunStateRow {
    const row = this.deps.db.getRunState(id);
    if (!row) throw new RunStateError(404, 'run not found');
    return row;
  }
}

export function toRunDto(row: RunStateRow): RunState {
  let brief: ResumeBrief = {
    lastUserText: '',
    lastAssistantTail: '',
    anchorMessageID: '',
    queuedCount: 0,
  };
  try {
    const parsed = JSON.parse(row.brief_json);
    if (parsed && typeof parsed === 'object') {
      brief = {
        lastUserText: String(parsed.lastUserText ?? ''),
        lastAssistantTail: String(parsed.lastAssistantTail ?? ''),
        anchorMessageID: String(parsed.anchorMessageID ?? ''),
        queuedCount: Number(parsed.queuedCount ?? 0) || 0,
      };
    }
  } catch { /* corrupted brief = empty (fail-open) */ }
  return {
    id: row.id,
    sessionID: row.session_id,
    projectDir: row.project_dir,
    status: (ACTIVE.has(row.status as RunStatus) || ['completed', 'failed', 'cancelled'].includes(row.status)
      ? row.status
      : 'cancelled') as RunStatus,
    ...(row.reason ? { reason: row.reason } : {}),
    brief,
    createdAt: row.created_at,
    suspendedAt: row.suspended_at,
    ...(row.resumed_at ? { resumedAt: row.resumed_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  };
}
