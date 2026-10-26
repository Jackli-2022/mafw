/**
 * T2-1 Task 5: 三态 restore（mock deps）。
 * 语义：session=只截断历史；files=只回工作区（正向补丁）；both=opencode 全语义。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CheckpointRestoreError,
  CheckpointService,
  type CheckpointServiceDeps,
} from '../../../src/core/checkpoint/checkpoint-service';
import type { SessionCheckpointRow } from '../../../src/memory/gateway-db';

const T1 = 'a'.repeat(40);
const T2 = 'b'.repeat(40);

function baseRow(over: Partial<SessionCheckpointRow> = {}): SessionCheckpointRow {
  return {
    id: 'ckpt_1',
    session_id: 's1',
    project_dir: '/tmp/does-not-matter',
    anchor_message_id: 'u1',
    snapshot_tree: T1,
    untracked_json: '[]',
    kind: 'auto',
    created_at: '2026-10-26T00:00:00Z',
    ...over,
  };
}

function harness(opts: {
  row?: SessionCheckpointRow | null;
  latestTree?: string | null;
  patch?: string;
  preCheckCode?: number;
  applyCode?: number;
  quietCode?: number;
  porcelain?: string;
  repoFound?: boolean;
  rememberedTree?: string;
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ckpt-restore-'));
  if (opts.repoFound !== false) {
    fs.mkdirSync(path.join(root, 'pid', 'repo'), { recursive: true });
  }

  const row = opts.row === undefined ? baseRow() : opts.row;
  const rows = new Map<string, SessionCheckpointRow>();
  if (row) rows.set(row.id, row);

  const log: string[] = [];
  const calls = {
    reverts: [] as Array<{ sessionID: string; messageID: string; files?: boolean }>,
    applies: [] as string[],
    deleteAfter: [] as Array<{ sessionId: string; at: string }>,
    deletedFrom: [] as Array<{ sessionId: string; at: string }>,
    deletedOne: [] as string[],
    gitDiffs: [] as string[][],
    checks: [] as string[][],
    quiet: [] as string[][],
    broadcasts: [] as any[],
    workspaceWrites: [] as Array<{ sid: string; tree: string | null }>,
  };
  const workspaceTrees = new Map<string, string>();
  if (opts.rememberedTree) workspaceTrees.set('s1', opts.rememberedTree);

  const git: CheckpointServiceDeps['git'] = {
    run: async (args) => {
      if (args.includes('cat-file')) return { code: 0, stdout: 'tree', stderr: '' };
      if (args.includes('diff-files')) {
        calls.quiet.push(args);
        return { code: opts.quietCode ?? 0, stdout: '', stderr: '' };
      }
      if (args.includes('diff') && args.includes('--quiet')) {
        calls.quiet.push(args);
        return { code: opts.quietCode ?? 0, stdout: '', stderr: '' };
      }
      if (args.includes('diff') && args.includes('--binary')) {
        calls.gitDiffs.push(args);
        return { code: 0, stdout: opts.patch ?? 'diff --git a/f b/f\n--- a/f\n+++ b/f\n', stderr: '' };
      }
      if (args.includes('apply')) {
        const file = args[args.length - 1];
        const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
        if (args.includes('--check')) {
          calls.checks.push(args);
          return { code: opts.preCheckCode ?? 0, stdout: '', stderr: '' };
        }
        log.push('apply');
        calls.applies.push(text);
        return { code: opts.applyCode ?? 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  };

  let seq = 0;
  const deps: CheckpointServiceDeps = {
    db: {
      insertSessionCheckpoint: (r) => { rows.set(r.id, r); },
      getSessionCheckpoint: (id) => rows.get(id),
      listSessionCheckpoints: (sid) => [...rows.values()].filter((r) => r.session_id === sid),
      pruneSessionAutoCheckpoints: () => 0,
      deleteSessionCheckpointsAfter: (sessionId, at) => {
        calls.deleteAfter.push({ sessionId, at });
        return 0;
      },
      deleteSessionCheckpointsFrom: (sessionId, at) => {
        calls.deletedFrom.push({ sessionId, at });
        return 0;
      },
      deleteSessionCheckpoint: (id) => {
        calls.deletedOne.push(id);
        rows.delete(id);
      },
      deleteSessionCheckpoints: () => {},
    },
    runtime: {
      session: {
        get: async () => ({ id: 's1', projectID: 'pid' }),
        messages: async () => ({
          data: [
            { id: 'u1', role: 'user', time: { created: 1 } },
            {
              id: 'a1',
              role: 'assistant',
              time: { created: 2 },
              snapshot: { start: T1, end: opts.latestTree === undefined ? T2 : opts.latestTree ?? undefined },
            },
          ],
        }),
        revert: async (o) => { calls.reverts.push(o); },
      },
    },
    git,
    porcelainOf: async () => opts.porcelain ?? '',
    readWorkspaceTree: (sid) => workspaceTrees.get(sid) ?? null,
    writeWorkspaceTree: (sid, tree) => {
      calls.workspaceWrites.push({ sid, tree });
      if (tree) workspaceTrees.set(sid, tree);
      else workspaceTrees.delete(sid);
    },
    snapshotRoot: root,
    broadcast: (event) => { log.push('broadcast'); calls.broadcasts.push(event); },
    now: () => '2026-10-26T01:00:00Z',
    newId: () => `ckpt_new_${++seq}`,
  };

  return { service: new CheckpointService(deps), rows, calls, log, root };
}

describe('restore: lookup + session scope', () => {
  it('404 for unknown checkpoint or wrong session', async () => {
    const { service } = harness({ row: null });
    await expect(service.restore({ sessionID: 's1', checkpointId: 'nope', scope: 'session' }))
      .rejects.toMatchObject({ status: 404 });

    const h = harness();
    await expect(h.service.restore({ sessionID: 'other', checkpointId: 'ckpt_1', scope: 'session' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('session scope truncates history only (files:false) and rewinds the timeline', async () => {
    const h = harness();
    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'session' });

    expect(result).toEqual({ scope: 'session' });
    expect(h.calls.reverts).toEqual([{ sessionID: 's1', messageID: 'u1', files: false }]);
    // 目标 checkpoint 的 anchor 消息会被 revert 删除 → 目标自身也失效
    expect(h.calls.deletedFrom).toEqual([{ sessionId: 's1', at: '2026-10-26T00:00:00Z' }]);
    expect(h.calls.broadcasts).toEqual([]); // 不可逆操作不造 pre-restore 后悔药
    expect(h.calls.applies).toEqual([]);
    // files:false 不动工作区 → 保留工作区树记忆
    expect(h.calls.workspaceWrites).toEqual([]);
  });

  it('rejects session scope on manual checkpoints (files-only)', async () => {
    const h = harness({ row: baseRow({ kind: 'manual' }) });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'session' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'both' }))
      .rejects.toMatchObject({ status: 400 });
    expect(h.calls.reverts).toEqual([]);
  });
});

describe('restore: both scope', () => {
  it('uses opencode full revert (files:true) + timeline rewind + leftover', async () => {
    const h = harness({ porcelain: '?? keep.txt\n?? new.txt\n' });
    // checkpoint 当时已存在 keep.txt → 只有 new.txt 是残留
    h.rows.set('ckpt_1', baseRow({ untracked_json: JSON.stringify(['keep.txt']) }));

    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'both' });

    expect(h.calls.reverts).toEqual([{ sessionID: 's1', messageID: 'u1', files: true }]);
    expect(h.calls.deletedFrom).toHaveLength(1);
    // files:true 把工作区回滚到 checkpoint 树 → 记忆同步目标树
    expect(h.calls.workspaceWrites).toEqual([{ sid: 's1', tree: T1 }]);
    expect(result).toEqual({ scope: 'both', leftoverUntracked: ['new.txt'] });
  });

  it('tree=null degrades to session-only with filesSkipped', async () => {
    const h = harness({ row: baseRow({ snapshot_tree: null }) });
    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'both' });

    expect(h.calls.reverts).toEqual([{ sessionID: 's1', messageID: 'u1', files: false }]);
    expect(h.calls.workspaceWrites).toEqual([]); // 文件侧未动
    expect(result).toEqual({ scope: 'both', filesSkipped: true, leftoverUntracked: [] });
  });
});

describe('restore: files scope', () => {
  it('400 when checkpoint has no file state', async () => {
    const h = harness({ row: baseRow({ snapshot_tree: null }) });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('404 when there is no current snapshot tree and no remembered workspace', async () => {
    const h = harness({ latestTree: null });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('uses the remembered workspace tree when history was truncated (latest missing)', async () => {
    const h = harness({ latestTree: null, rememberedTree: T2 });
    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });
    expect(result.scope).toBe('files');
    expect(h.calls.gitDiffs[0]).toEqual(expect.arrayContaining(['diff', '--binary', T2, T1]));
  });

  it('404 when snapshot repo cannot be located (pruned)', async () => {
    const h = harness({ repoFound: false });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('is a no-op only after verifying the worktree matches (git diff --quiet)', async () => {
    const h = harness({ latestTree: T1, porcelain: '?? new.txt\n' });
    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });

    expect(result).toEqual({ scope: 'files', leftoverUntracked: ['new.txt'] });
    expect(h.calls.applies).toEqual([]);
    expect(h.calls.broadcasts).toEqual([]);
    expect(h.calls.quiet).toHaveLength(1);
  });

  it('400 (not a silent no-op) when the worktree has out-of-turn edits at the target tree', async () => {
    const h = harness({ latestTree: T1, quietCode: 1 });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }))
      .rejects.toMatchObject({ status: 400 });
    expect(h.calls.applies).toEqual([]);
  });

  it('502 on apply failure and removes the just-created pre-restore row', async () => {
    const h = harness({ applyCode: 1 });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }))
      .rejects.toMatchObject({ status: 502 });
    expect(h.calls.deletedOne).toEqual(['ckpt_new_1']);
    expect(h.rows.has('ckpt_new_1')).toBe(false);
    // 失败不更新工作区记忆
    expect(h.calls.workspaceWrites).toEqual([]);
  });

  it('creates pre-restore checkpoint AFTER pre-check and BEFORE apply; applies forward patch', async () => {
    const h = harness({ patch: 'diff --git a/f b/f\n--- a/f\n+++ b/f\n' });
    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });

    expect(h.log).toEqual(['broadcast', 'apply']);
    expect(h.calls.applies).toEqual(['diff --git a/f b/f\n--- a/f\n+++ b/f\n']);
    expect(result.scope).toBe('files');
    expect(result.preRestoreCheckpointId).toBe('ckpt_new_1');
    // pre-restore 树 = 补丁基线（正常路径 = 最新树，即恢复前状态）
    const pre = h.rows.get('ckpt_new_1')!;
    expect(pre.snapshot_tree).toBe(T2);
    expect(pre.kind).toBe('auto');
    // diff 参数：base(latest) → ckpt（正向补丁），带 --binary 与同 turn-diff 的硬化旗标
    const diffArgs = h.calls.gitDiffs[0];
    expect(diffArgs).toEqual(expect.arrayContaining([
      'diff', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', T2, T1,
    ]));
    // 预检走 -C 项目目录（git apply 相对路径按 cwd 解析）
    const checkArgs = h.calls.checks[0];
    expect(checkArgs).toEqual(expect.arrayContaining(['-C', '/tmp/does-not-matter', 'apply', '--check']));
    // 成功恢复后记住工作区树 = 目标树（供后悔药/连续恢复使用）
    expect(h.calls.workspaceWrites).toEqual([{ sid: 's1', tree: T1 }]);
  });

  it('undo path: restores back to the pre-restore tree using the remembered workspace base', async () => {
    // 上次 files 恢复把工作区留在 T1；历史最新树仍是 T2。现在恢复到「恢复前」检查点（树=T2）。
    const h = harness({ rememberedTree: T1, latestTree: T2 });
    h.rows.set('ckpt_pre', baseRow({ id: 'ckpt_pre', snapshot_tree: T2 }));

    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_pre', scope: 'files' });

    const diffArgs = h.calls.gitDiffs[0];
    expect(diffArgs).toEqual(expect.arrayContaining(['diff', '--binary', T1, T2]));
    expect(h.calls.applies).toHaveLength(1);
    expect(h.calls.workspaceWrites).toEqual([{ sid: 's1', tree: T2 }]);
    const pre = h.rows.get(result.preRestoreCheckpointId!)!;
    expect(pre.snapshot_tree).toBe(T1); // 当前工作区（基线）
  });

  it('ignores an invalid remembered tree (falls back to the latest history tree)', async () => {
    const h = harness({ rememberedTree: 'not-a-tree', latestTree: T2 });
    await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });
    expect(h.calls.gitDiffs[0]).toEqual(expect.arrayContaining(['diff', '--binary', T2, T1]));
  });

  it('400 on pre-check failure and never applies', async () => {
    const h = harness({ preCheckCode: 1 });
    await expect(h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }))
      .rejects.toMatchObject({ status: 400 });
    expect(h.calls.applies).toEqual([]);
    // 预检失败不留下 pre-restore checkpoint
    expect(h.calls.broadcasts).toEqual([]);
  });

  it('leftover = current untracked minus checkpoint-time untracked', async () => {
    const h = harness({ porcelain: '?? keep.txt\n?? fresh.txt\n?? dir/\n', latestTree: T1 });
    h.rows.set('ckpt_1', baseRow({ untracked_json: JSON.stringify(['keep.txt']) }));

    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });
    expect(result.leftoverUntracked).toEqual(['fresh.txt', 'dir/']);
  });

  it('errors carry CheckpointRestoreError for route-level status mapping', async () => {
    const h = harness({ row: baseRow({ snapshot_tree: null }) });
    const err = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }).catch((e) => e);
    expect(err).toBeInstanceOf(CheckpointRestoreError);
  });
});
