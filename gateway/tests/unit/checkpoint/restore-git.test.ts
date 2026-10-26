/**
 * T2-1 Task 5: restore files 真实 git 集成（正向补丁 latest→ckpt）。
 * fixture：项目仓两棵树（tree1=base, tree2=修改 file1 + 新增 file2），
 * bare clone 作为 opencode snapshot repo（root/<pid>/repo）。
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import {
  CheckpointService,
  type CheckpointServiceDeps,
} from '../../../src/core/checkpoint/checkpoint-service';
import { defaultGit } from '../../../src/core/diff/turn-diff';
import type { SessionCheckpointRow } from '../../../src/memory/gateway-db';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  return stdout.trim();
}

interface Fixture {
  root: string;
  project: string;
  bare: string;
  tree1: string;
  tree2: string;
}

async function makeFixture(): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ckpt-git-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });

  await git(project, ['init', '-q']);
  await git(project, ['config', 'user.email', 't@example.com']);
  await git(project, ['config', 'user.name', 't']);
  await git(project, ['config', 'core.autocrlf', 'false']);

  fs.writeFileSync(path.join(project, 'file1.txt'), 'A\n');
  await git(project, ['add', '.']);
  await git(project, ['commit', '-q', '-m', 'base']);
  const tree1 = await git(project, ['rev-parse', 'HEAD^{tree}']);

  fs.writeFileSync(path.join(project, 'file1.txt'), 'B\n');
  fs.writeFileSync(path.join(project, 'file2.txt'), 'NEW\n');
  await git(project, ['add', '.']);
  await git(project, ['commit', '-q', '-m', 'change']);
  const tree2 = await git(project, ['rev-parse', 'HEAD^{tree}']);

  const bare = path.join(root, 'pid', 'repo');
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  await exec('git', ['clone', '-q', '--bare', project, bare], { windowsHide: true, encoding: 'utf8' });

  return { root, project, bare, tree1, tree2 };
}

function harness(fx: Fixture, checkpointTree: string | null, untracked: string[] = []) {
  const rows = new Map<string, SessionCheckpointRow>();
  rows.set('ckpt_1', {
    id: 'ckpt_1',
    session_id: 's1',
    project_dir: fx.project,
    anchor_message_id: 'u1',
    snapshot_tree: checkpointTree,
    untracked_json: JSON.stringify(untracked),
    kind: 'auto',
    created_at: '2026-10-26T00:00:00Z',
  });
  const workspaceTrees = new Map<string, string>();

  const deps: CheckpointServiceDeps = {
    db: {
      insertSessionCheckpoint: (r) => { rows.set(r.id, r); },
      getSessionCheckpoint: (id) => rows.get(id),
      listSessionCheckpoints: (sid) => [...rows.values()].filter((r) => r.session_id === sid),
      pruneSessionAutoCheckpoints: () => 0,
      deleteSessionCheckpointsAfter: () => 0,
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
              snapshot: { start: fx.tree1, end: fx.tree2 },
            },
          ],
        }),
        revert: async () => { throw new Error('revert must not be called in files scope'); },
        vcs: {
          apply: async ({ patch }) => {
            // 与生产一致：把 patch 交给项目工作区的 git apply（stdin 不便于跨平台，写临时文件）
            const f = path.join(fx.root, `apply-${Date.now()}.patch`);
            fs.writeFileSync(f, patch, 'utf-8');
            try {
              await git(fx.project, ['apply', f]);
            } finally {
              fs.rmSync(f, { force: true });
            }
          },
        },
      },
    },
    git: defaultGit,
    porcelainOf: async (projectDir) => git(projectDir, ['status', '--porcelain']).then((s) => s, () => ''),
    readWorkspaceTree: (sid) => workspaceTrees.get(sid) ?? null,
    writeWorkspaceTree: (sid, tree) => {
      if (tree) workspaceTrees.set(sid, tree);
      else workspaceTrees.delete(sid);
    },
    snapshotRoot: fx.root,
    broadcast: () => {},
    now: () => '2026-10-26T01:00:00Z',
    newId: () => `ckpt_pre_${Math.random().toString(36).slice(2, 8)}`,
  };

  return { service: new CheckpointService(deps), rows };
}

describe('restore files (real git)', () => {
  it('rolls tracked files back to the checkpoint tree, including deleting files added later', async () => {
    const fx = await makeFixture();
    const h = harness(fx, fx.tree1);

    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });

    expect(fs.readFileSync(path.join(fx.project, 'file1.txt'), 'utf8')).toBe('A\n');
    expect(fs.existsSync(path.join(fx.project, 'file2.txt'))).toBe(false);
    expect(result.leftoverUntracked).toEqual([]);
    expect(result.preRestoreCheckpointId).toBeDefined();

    // pre-restore 记录恢复前状态（tree2）
    const pre = [...h.rows.values()].find((r) => r.id === result.preRestoreCheckpointId)!;
    expect(pre.snapshot_tree).toBe(fx.tree2);
  });

  it('refuses (400) when the workspace has out-of-turn edits; nothing is applied', async () => {
    const fx = await makeFixture();
    // 回合外手工编辑：file1 改成 C（既非 tree1 也非 tree2）
    fs.writeFileSync(path.join(fx.project, 'file1.txt'), 'C\n');
    const h = harness(fx, fx.tree1);

    await expect(
      h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' }),
    ).rejects.toMatchObject({ status: 400 });

    expect(fs.readFileSync(path.join(fx.project, 'file1.txt'), 'utf8')).toBe('C\n');
    expect(fs.existsSync(path.join(fx.project, 'file2.txt'))).toBe(true); // 未部分应用
    expect(h.rows.size).toBe(1); // 未留下 pre-restore 检查点
  });

  it('reports untracked leftovers without deleting them', async () => {
    const fx = await makeFixture();
    fs.writeFileSync(path.join(fx.project, 'new-note.txt'), 'mine\n');
    const h = harness(fx, fx.tree1);

    const result = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });

    expect(result.leftoverUntracked).toContain('new-note.txt');
    expect(fs.existsSync(path.join(fx.project, 'new-note.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(fx.project, 'file1.txt'), 'utf8')).toBe('A\n');
  });

  it('second identical restore is a true no-op (workspace memory)', async () => {
    const fx = await makeFixture();
    const h = harness(fx, fx.tree1);

    await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });
    // 第一次恢复把工作区留在 tree1（记忆=tree1）；第二次 base=tree1=target → 幂等成功
    const second = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });
    expect(second.scope).toBe('files');
    expect(second.preRestoreCheckpointId).toBeUndefined();
  });

  it('undo: restores back to the pre-restore checkpoint (file re-added, content restored)', async () => {
    const fx = await makeFixture();
    const h = harness(fx, fx.tree1);

    const first = await h.service.restore({ sessionID: 's1', checkpointId: 'ckpt_1', scope: 'files' });
    expect(fs.existsSync(path.join(fx.project, 'file2.txt'))).toBe(false);

    // 后悔药：恢复到 pre-restore（tree2）
    const undo = await h.service.restore({
      sessionID: 's1',
      checkpointId: first.preRestoreCheckpointId!,
      scope: 'files',
    });

    expect(undo.scope).toBe('files');
    expect(fs.readFileSync(path.join(fx.project, 'file1.txt'), 'utf8')).toBe('B\n');
    expect(fs.readFileSync(path.join(fx.project, 'file2.txt'), 'utf8')).toBe('NEW\n');
  });
});
