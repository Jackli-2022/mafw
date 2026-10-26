/**
 * T2-1 CheckpointService —— 检查点创建/列表（restore 在本文件随 Task 5 增补）。
 *
 * deps 全注入：db（gateway.db 六方法）、runtime（revert/messages/vcs）、
 * snapshot git、porcelain 读取、事件广播与时钟。create/list 路径只触碰
 * db/broadcast/now/newId——restore 成员由 Task 5 使用。
 */
import type { SessionCheckpointRow } from '../../memory/gateway-db';

export interface SessionCheckpoint {
  id: string;
  sessionID: string;
  projectDir: string;
  anchorMessageID: string;
  snapshotTree: string | null;
  untracked: string[];
  kind: 'auto' | 'manual';
  createdAt: string;
}

export interface CheckpointDbDeps {
  insertSessionCheckpoint(row: SessionCheckpointRow): void;
  getSessionCheckpoint(id: string): SessionCheckpointRow | undefined;
  listSessionCheckpoints(sessionId: string): SessionCheckpointRow[];
  pruneSessionAutoCheckpoints(sessionId: string, keep: number): number;
  deleteSessionCheckpointsAfter(sessionId: string, createdAtIso: string): number;
  deleteSessionCheckpoints(sessionId: string): void;
}

export interface CheckpointGitRunner {
  run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface CheckpointServiceDeps {
  db: CheckpointDbDeps;
  runtime: {
    session: {
      get(opts: { sessionID: string }): Promise<any>;
      messages(opts: { sessionID: string; limit?: number }): Promise<{ data: any[] }>;
      revert(opts: { sessionID: string; messageID: string; files?: boolean }): Promise<void>;
      vcs: { apply(opts: { patch: string }): Promise<void> };
    };
  };
  git: CheckpointGitRunner;
  /** `git status --porcelain` 原文（注入以便测试；生产走 simple-git）。 */
  porcelainOf(projectDir: string): Promise<string>;
  snapshotRoot?: string;
  broadcast(event: { type: string; [key: string]: any }): void;
  now(): string;
  newId(): string;
}

const AUTO_KEEP = 100;

export class CheckpointService {
  constructor(private deps: CheckpointServiceDeps) {}

  create(input: {
    sessionID: string;
    projectDir: string;
    anchorMessageID: string;
    snapshotTree: string | null;
    untracked: string[];
    kind: 'auto' | 'manual';
  }): SessionCheckpoint {
    const checkpoint: SessionCheckpoint = {
      id: this.deps.newId(),
      sessionID: input.sessionID,
      projectDir: input.projectDir,
      anchorMessageID: input.anchorMessageID,
      snapshotTree: input.snapshotTree,
      untracked: [...input.untracked],
      kind: input.kind,
      createdAt: this.deps.now(),
    };

    this.deps.db.insertSessionCheckpoint({
      id: checkpoint.id,
      session_id: checkpoint.sessionID,
      project_dir: checkpoint.projectDir,
      anchor_message_id: checkpoint.anchorMessageID,
      snapshot_tree: checkpoint.snapshotTree,
      untracked_json: JSON.stringify(checkpoint.untracked),
      kind: checkpoint.kind,
      created_at: checkpoint.createdAt,
    });

    if (checkpoint.kind === 'auto') {
      this.deps.db.pruneSessionAutoCheckpoints(checkpoint.sessionID, AUTO_KEEP);
    }

    this.deps.broadcast({
      type: 'session.checkpoint',
      properties: {
        sessionID: checkpoint.sessionID,
        checkpointId: checkpoint.id,
        kind: checkpoint.kind,
      },
      sessionID: checkpoint.sessionID,
    });

    return checkpoint;
  }

  list(sessionID: string): SessionCheckpoint[] {
    return this.deps.db.listSessionCheckpoints(sessionID).map(toDto);
  }
}

export function toDto(row: SessionCheckpointRow): SessionCheckpoint {
  let untracked: string[] = [];
  try {
    const parsed = JSON.parse(row.untracked_json);
    if (Array.isArray(parsed)) untracked = parsed.filter((x): x is string => typeof x === 'string');
  } catch { /* corrupted json = empty list (fail-open) */ }
  return {
    id: row.id,
    sessionID: row.session_id,
    projectDir: row.project_dir,
    anchorMessageID: row.anchor_message_id,
    snapshotTree: row.snapshot_tree,
    untracked,
    kind: row.kind === 'manual' ? 'manual' : 'auto',
    createdAt: row.created_at,
  };
}
