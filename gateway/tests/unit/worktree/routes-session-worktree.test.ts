// POST /api/session 带 worktree 参数的创建编排 + session 删除联动清理（deps 注入可单测）。
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { createSessionWithWorktree, cleanupWorktreeForSession, WorktreeSessionDeps } from '../../../src/routes/session-worktree';

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-wt-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execSync('git add . && git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function makeDeps() {
  const kv = new Map<string, any>();
  const created: any[] = [];
  const deps: WorktreeSessionDeps = {
    kvGet: (key, id) => kv.get(`${key}/${id}`),
    kvSet: (key, id, v) => { kv.set(`${key}/${id}`, v); },
    kvDel: (key, id) => { kv.delete(`${key}/${id}`); },
    createSession: (directory: string | undefined) => {
      const id = `sess-${created.length + 1}`;
      created.push({ id, directory });
      return Promise.resolve({ id });
    },
  };
  return { deps, kv, created };
}

describe('createSessionWithWorktree', () => {
  test('creates git worktree + session with worktree directory + kv mapping', async () => {
    const repo = tmpRepo();
    const { deps, created, kv } = makeDeps();
    const r = await createSessionWithWorktree(deps, { directory: repo, worktree: true });
    expect(created).toHaveLength(1);
    expect(created[0].directory).toContain('-wt-');
    expect(r.worktree?.branch).toMatch(/^mafw\//);
    expect(r.session.id).toBe('sess-1');
    expect(kv.get(`session-worktree/sess-1`)).toMatchObject({ branch: r.worktree!.branch, projectDir: path.resolve(repo) });
    expect(fs.existsSync(created[0].directory)).toBe(true);
  });

  test('worktree: "<slug>" custom slug honored', async () => {
    const repo = tmpRepo();
    const { deps } = makeDeps();
    const r = await createSessionWithWorktree(deps, { directory: repo, worktree: 'fix-api' });
    expect(r.worktree?.branch).toBe('mafw/fix-api');
  });

  test('no worktree flag → plain create with original directory, no kv', async () => {
    const repo = tmpRepo();
    const { deps, created, kv } = makeDeps();
    const r = await createSessionWithWorktree(deps, { directory: repo });
    expect(r.worktree).toBeUndefined();
    expect(path.resolve(created[0].directory)).toBe(path.resolve(repo));
    expect([...kv.keys()]).toEqual([]);
  });
});

describe('cleanupWorktreeForSession', () => {
  test('deletes mapping and removes worktree + branch (best-effort)', async () => {
    const repo = tmpRepo();
    const { deps, kv } = makeDeps();
    const r = await createSessionWithWorktree(deps, { directory: repo, worktree: 'cleanup-me' });
    expect(fs.existsSync(r.worktree!.dir)).toBe(true);
    await cleanupWorktreeForSession(deps, 'sess-1');
    expect(kv.has('session-worktree/sess-1')).toBe(false);
    expect(fs.existsSync(r.worktree!.dir)).toBe(false);
    const branches = execSync('git branch --list mafw/*', { cwd: repo }).toString();
    expect(branches).not.toContain('cleanup-me');
  });

  test('no mapping → no-op', async () => {
    const { deps, kv } = makeDeps();
    await cleanupWorktreeForSession(deps, 'nope');
    expect(kv.size).toBe(0);
  });

  test('worktree remove failure → fail-open (mapping still cleaned)', async () => {
    const repo = tmpRepo();
    const { deps, kv } = makeDeps();
    await createSessionWithWorktree(deps, { directory: repo, worktree: 'boom' });
    // 破坏：把映射指向不存在的 worktree 目录
    kv.set('session-worktree/sess-1', { dir: path.join(os.tmpdir(), 'definitely-missing-wt'), branch: 'mafw/boom', projectDir: repo });
    await expect(cleanupWorktreeForSession(deps, 'sess-1')).resolves.toBeUndefined();
    expect(kv.has('session-worktree/sess-1')).toBe(false);
  });
});
