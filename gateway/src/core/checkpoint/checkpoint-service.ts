/**
 * T2-1 CheckpointService —— 检查点创建/列表（restore 在本文件随 Task 5 增补）。
 *
 * deps 全注入：db（gateway.db 六方法）、runtime（revert/messages/vcs）、
 * snapshot git、porcelain 读取、事件广播与时钟。create/list 路径只触碰
 * db/broadcast/now/newId——restore 成员由 Task 5 使用。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { SessionCheckpointRow } from '../../memory/gateway-db';
import {
  defaultSnapshotRoot,
  findSnapshotRepo,
  isSnapshotId,
  type GitRunner,
} from '../diff/turn-diff';
import { applyPatchToWorktree } from '../diff/apply-patch';
import { latestSnapshotTree, manualAnchor, parseUntrackedLines } from './auto-recorder';

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

export type CheckpointScope = 'session' | 'files' | 'both';

export interface CheckpointRestoreResult {
  scope: CheckpointScope;
  /** both + tree=null：文件侧无历史状态，降级为仅对话截断。 */
  filesSkipped?: boolean;
  /** restore 后仍未受控（不在 checkpoint 清单里）的 untracked 文件；仅报告不删除。 */
  leftoverUntracked?: string[];
  /** files restore 的后悔药（恢复前状态检查点）。 */
  preRestoreCheckpointId?: string;
}

export class CheckpointRestoreError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'CheckpointRestoreError';
  }
}

export interface CheckpointDbDeps {
  insertSessionCheckpoint(row: SessionCheckpointRow): void;
  getSessionCheckpoint(id: string): SessionCheckpointRow | undefined;
  listSessionCheckpoints(sessionId: string): SessionCheckpointRow[];
  pruneSessionAutoCheckpoints(sessionId: string, keep: number): number;
  deleteSessionCheckpointsAfter(sessionId: string, createdAtIso: string): number;
  deleteSessionCheckpointsFrom(sessionId: string, createdAtIso: string): number;
  deleteSessionCheckpoint(id: string): void;
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
    };
  };
  git: GitRunner;
  /** `git status --porcelain` 原文（注入以便测试；生产走 simple-git）。 */
  porcelainOf(projectDir: string): Promise<string>;
  /** 每会话「当前工作区树」记忆：files 恢复后工作区不再等于历史最新树，
   *  下一次恢复（含后悔药）必须以此为补丁基线；新回合/全量恢复时清空。 */
  readWorkspaceTree(sessionID: string): string | null;
  writeWorkspaceTree(sessionID: string, tree: string | null): void;
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

  /** 会话删除联动（wave1 session.delete cleanup 链，fail-open 由调用侧兜底）。 */
  deleteForSession(sessionID: string): void {
    this.deps.db.deleteSessionCheckpoints(sessionID);
    this.deps.writeWorkspaceTree(sessionID, null);
  }

  /** 手动检查点：锚点=显式 messageID 或最后一条已持久化消息；树=最后已知 end。 */
  async createManual(input: { sessionID: string; messageID?: string }): Promise<SessionCheckpoint> {
    const session = await this.deps.runtime.session.get({ sessionID: input.sessionID });
    const projectDir = session?.directory ?? session?.location?.directory;
    if (typeof projectDir !== 'string' || !projectDir) {
      throw new CheckpointRestoreError(400, 'session directory unavailable');
    }

    const result = await this.deps.runtime.session.messages({
      sessionID: input.sessionID,
      limit: 200,
    });
    const messages = Array.isArray(result?.data) ? result.data : [];
    const anchor = manualAnchor(messages, input.messageID);
    if (!anchor) {
      throw new CheckpointRestoreError(400, 'no persisted messages');
    }

    return this.create({
      sessionID: input.sessionID,
      projectDir,
      anchorMessageID: anchor.anchorMessageID,
      // 手动快照 =「当前工作区」：上次 files 恢复后工作区可能不等于历史最新树
      snapshotTree: this.deps.readWorkspaceTree(input.sessionID) ?? latestSnapshotTree(messages),
      untracked: parseUntrackedLines(await this.deps.porcelainOf(projectDir)),
      kind: 'manual',
    });
  }

  async restore(input: {
    sessionID: string;
    checkpointId: string;
    scope: CheckpointScope;
  }): Promise<CheckpointRestoreResult> {
    const row = this.deps.db.getSessionCheckpoint(input.checkpointId);
    if (!row || row.session_id !== input.sessionID) {
      throw new CheckpointRestoreError(404, 'checkpoint not found');
    }
    const ckpt = toDto(row);

    // 手动检查点只快照文件状态（anchor=末尾消息，opencode revert 会删掉它，
    // 「回到现在」不存在）——会话级恢复只对 turn 边界自动检查点开放。
    if (ckpt.kind === 'manual' && input.scope !== 'files') {
      throw new CheckpointRestoreError(400, 'manual checkpoint is files-only');
    }

    if (input.scope === 'session') {
      await this.revertTo(ckpt, false);
      this.rewindTimeline(ckpt);
      // files:false → 工作区未动，保留工作区树记忆
      return { scope: 'session' };
    }

    if (input.scope === 'both') {
      if (ckpt.snapshotTree === null) {
        await this.revertTo(ckpt, false);
        this.rewindTimeline(ckpt);
        // 文件侧未动，保留记忆
        return {
          scope: 'both',
          filesSkipped: true,
          leftoverUntracked: await this.leftover(ckpt),
        };
      }
      await this.revertTo(ckpt, true);
      this.rewindTimeline(ckpt);
      // files:true 把工作区回滚到 checkpoint 树 → 记忆同步为目标树
      this.deps.writeWorkspaceTree(ckpt.sessionID, ckpt.snapshotTree);
      return { scope: 'both', leftoverUntracked: await this.leftover(ckpt) };
    }

    return this.restoreFiles(ckpt);
  }

  private async revertTo(ckpt: SessionCheckpoint, files: boolean): Promise<void> {
    await this.deps.runtime.session.revert({
      sessionID: ckpt.sessionID,
      messageID: ckpt.anchorMessageID,
      files,
    });
  }

  /** opencode revert 删除 anchor 消息本身 → 目标条目也失效；删除目标及更新条目。 */
  private rewindTimeline(ckpt: SessionCheckpoint): void {
    this.deps.db.deleteSessionCheckpointsFrom(ckpt.sessionID, ckpt.createdAt);
  }

  private async leftover(ckpt: SessionCheckpoint): Promise<string[]> {
    const current = parseUntrackedLines(await this.deps.porcelainOf(ckpt.projectDir));
    return current.filter((f) => !ckpt.untracked.includes(f));
  }

  private async restoreFiles(ckpt: SessionCheckpoint): Promise<CheckpointRestoreResult> {
    const tree = ckpt.snapshotTree;
    if (tree === null) {
      throw new CheckpointRestoreError(400, 'checkpoint has no file state');
    }

    const result = await this.deps.runtime.session.messages({
      sessionID: ckpt.sessionID,
      limit: 200,
    });
    const messages = Array.isArray(result?.data) ? result.data : [];
    const latest = latestSnapshotTree(messages);

    // 补丁基线：优先「上次恢复后的工作区树」（后悔药/连续恢复），否则历史最新树。
    // 历史被截断后 latest 可能缺失，但记忆里的工作区树仍可用。
    const remembered = this.deps.readWorkspaceTree(ckpt.sessionID);
    const base = isSnapshotId(remembered) ? remembered : latest;
    if (!base) {
      throw new CheckpointRestoreError(404, 'no current snapshot tree');
    }

    const session = await this.deps.runtime.session.get({ sessionID: ckpt.sessionID });
    const repo = await findSnapshotRepo({
      root: this.deps.snapshotRoot ?? defaultSnapshotRoot(),
      projectID: session?.projectID,
      start: tree,
      end: base,
      git: this.deps.git,
    });
    if (!repo) {
      throw new CheckpointRestoreError(404, 'snapshot trees not found (pruned?)');
    }

    if (base === tree) {
      // 幂等候选：工作区记忆/历史树指向目标，但工作区可能被回合外编辑过——
      // 用临时 index 把 tree 与真实工作区做 diff-files 证实（snapshot repo 无
      // index，直接 `git diff <tree>` 会因「must be run in a work tree」/空索引误判）。
      const idx = path.join(
        os.tmpdir(),
        `mafw-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const env = { GIT_INDEX_FILE: idx };
      let dirty = true;
      try {
        await this.deps.git.run(['--git-dir', repo, 'read-tree', tree], { env });
        // refresh 在有改动时返回 1 属预期；随后 diff-files 才是判定。
        await this.deps.git.run(
          ['--git-dir', repo, '--work-tree', ckpt.projectDir, 'update-index', '-q', '--refresh'],
          { env },
        );
        const check = await this.deps.git.run(
          ['--git-dir', repo, '--work-tree', ckpt.projectDir, 'diff-files', '--quiet', '--'],
          { env },
        );
        dirty = check.code !== 0;
      } finally {
        try { fs.rmSync(idx, { force: true }); } catch { /* best effort */ }
        try { fs.rmSync(`${idx}.lock`, { force: true }); } catch { /* best effort */ }
      }
      if (dirty) {
        throw new CheckpointRestoreError(
          400,
          'workspace differs from checkpoint (out-of-turn edits); commit/stash or choose another checkpoint',
        );
      }
      return { scope: 'files', leftoverUntracked: await this.leftover(ckpt) };
    }

    // 正向补丁：base → checkpoint（git 直接生成新增/删除/binary 的正确形态）。
    // 与 turn-diff 同款硬化：禁外部 diff/文本转换/颜色/重命名检测。
    const diff = await this.deps.git.run([
      '--git-dir', repo,
      '-c', 'core.quotePath=false', '-c', 'core.autocrlf=false',
      'diff', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
      base, tree,
    ]);
    if (diff.code !== 0) {
      throw new CheckpointRestoreError(
        502,
        `snapshot diff failed: ${(diff.stderr || '').trim().slice(0, 200) || `code ${diff.code}`}`,
      );
    }
    const patch = diff.stdout;

    if (patch.trim()) {
      await this.assertPatchApplies(repo, ckpt.projectDir, patch);
    }

    const preRestore = this.create({
      sessionID: ckpt.sessionID,
      projectDir: ckpt.projectDir,
      anchorMessageID: manualAnchor(messages)?.anchorMessageID ?? ckpt.anchorMessageID,
      snapshotTree: base,
      untracked: parseUntrackedLines(await this.deps.porcelainOf(ckpt.projectDir)),
      kind: 'auto',
    });

    if (patch.trim()) {
      const applied = await applyPatchToWorktree(this.deps.git, {
        projectDir: ckpt.projectDir,
        gitDir: repo,
        patch,
      });
      if (applied.code !== 0) {
        // 失败不留假后悔药（pre-restore 行尚未被任何恢复引用）。
        this.deps.db.deleteSessionCheckpoint(preRestore.id);
        throw new CheckpointRestoreError(
          502,
          `git apply failed: ${applied.stderr.trim().slice(0, 200) || `code ${applied.code}`}`,
        );
      }
    }
    this.deps.writeWorkspaceTree(ckpt.sessionID, tree);

    return {
      scope: 'files',
      leftoverUntracked: await this.leftover(ckpt),
      preRestoreCheckpointId: preRestore.id,
    };
  }

  /** git apply --check 预检（-C 项目目录：apply 的相对路径按 cwd 解析，--work-tree 不生效）：
   *  上下文失配 → 400，绝不部分应用。 */
  private async assertPatchApplies(repo: string, projectDir: string, patch: string): Promise<void> {
    const check = await applyPatchToWorktree(this.deps.git, {
      projectDir,
      gitDir: repo,
      patch,
      check: true,
    });
    if (check.code !== 0) {
      throw new CheckpointRestoreError(
        400,
        'workspace has out-of-turn changes; patch context mismatch',
      );
    }
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
