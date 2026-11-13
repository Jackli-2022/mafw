// POST /api/session 带 worktree 参数的创建编排 + session 删除联动清理（deps 注入可单测）。
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { createSessionWithWorktree, cleanupWorktreeForSession, WorktreeSessionDeps } from '../../../src/routes/session-worktree';
import { SessionWorktreeManager } from '../../../src/core/engine/session-worktree-manager';
import { tmpGitRepo } from './tmp-git';

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
    const repo = tmpGitRepo();
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
    const repo = tmpGitRepo();
    const { deps } = makeDeps();
    const r = await createSessionWithWorktree(deps, { directory: repo, worktree: 'fix-api' });
    expect(r.worktree?.branch).toBe('mafw/fix-api');
  });

  test('no worktree flag → plain create with original directory, no kv', async () => {
    const repo = tmpGitRepo();
    const { deps, created, kv } = makeDeps();
    const r = await createSessionWithWorktree(deps, { directory: repo });
    expect(r.worktree).toBeUndefined();
    expect(path.resolve(created[0].directory)).toBe(path.resolve(repo));
    expect([...kv.keys()]).toEqual([]);
  });

  test('availability unsupported → throws before creating anything', async () => {
    const repo = tmpGitRepo();
    const { deps, created, kv } = makeDeps();
    deps.worktreeAvailability = () => ({ supported: false, reason: 'unsupported' });
    await expect(
      createSessionWithWorktree(deps, { directory: repo, worktree: true }),
    ).rejects.toMatchObject({ code: 'worktree.unavailable', reason: 'unsupported' });
    expect(created).toHaveLength(0);
    expect([...kv.keys()]).toEqual([]);
    // 没有产生 worktree 目录
    expect(execSync('git branch --list mafw/*', { cwd: repo }).toString()).toBe('');
  });

  test('availability missing-data → throws with reason', async () => {
    const repo = tmpGitRepo();
    const { deps, created } = makeDeps();
    deps.worktreeAvailability = () => ({ supported: false, reason: 'missing-data' });
    await expect(
      createSessionWithWorktree(deps, { directory: repo, worktree: 'x' }),
    ).rejects.toMatchObject({ reason: 'missing-data' });
    expect(created).toHaveLength(0);
  });

  test('availability supported → creates worktree', async () => {
    const repo = tmpGitRepo();
    const { deps } = makeDeps();
    const seen: string[] = [];
    deps.worktreeAvailability = (directory) => {
      seen.push(directory);
      return { supported: true };
    };
    const r = await createSessionWithWorktree(deps, { directory: repo, worktree: 'ok' });
    expect(seen).toEqual([path.resolve(repo)]);
    expect(r.worktree?.branch).toBe('mafw/ok');
  });
});

describe('createSessionWithWorktree quota rollback (E7-3)', () => {
  function spyManager(repo: string) {
    const manager = new SessionWorktreeManager(path.resolve(repo));
    return { manager, remove: jest.spyOn(manager, 'remove') };
  }

  test('session creation rejected → worktree/branch rolled back, original error propagated, no kv', async () => {
    const repo = tmpGitRepo();
    const { deps, kv } = makeDeps();
    const { manager, remove } = spyManager(repo);
    deps.managerFactory = () => manager;
    const quota = Object.assign(new Error('QuotaExceededError: session quota exceeded'), {
      code: 'quota_exceeded',
      status: 429,
    });
    deps.createSession = () => Promise.reject(quota);

    await expect(
      createSessionWithWorktree(deps, { directory: repo, worktree: 'quota' }),
    ).rejects.toBe(quota);

    expect(remove).toHaveBeenCalledTimes(1);
    const [dir, branch] = remove.mock.calls[0];
    expect(branch).toBe('mafw/quota');
    expect(String(dir)).toContain('-wt-');
    expect(fs.existsSync(String(dir))).toBe(false);
    expect([...kv.keys()]).toEqual([]);
    expect(execSync('git branch --list mafw/quota', { cwd: repo }).toString()).toBe('');
  });

  test('rollback remove failure is best-effort → original error still wins', async () => {
    const repo = tmpGitRepo();
    const { deps } = makeDeps();
    const { manager, remove } = spyManager(repo);
    remove.mockRejectedValue(new Error('git worktree busy'));
    deps.managerFactory = () => manager;
    const quota = new Error('QuotaExceededError');
    deps.createSession = () => Promise.reject(quota);

    await expect(
      createSessionWithWorktree(deps, { directory: repo, worktree: 'quota-busy' }),
    ).rejects.toBe(quota);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('success path still writes kv mapping and does not roll back', async () => {
    const repo = tmpGitRepo();
    const { deps, kv } = makeDeps();
    const { manager, remove } = spyManager(repo);
    deps.managerFactory = () => manager;

    const r = await createSessionWithWorktree(deps, { directory: repo, worktree: 'happy' });

    expect(remove).not.toHaveBeenCalled();
    expect(kv.get('session-worktree/sess-1')).toMatchObject({
      dir: r.worktree!.dir,
      branch: 'mafw/happy',
      projectDir: path.resolve(repo),
    });
  });
});

describe('cleanupWorktreeForSession', () => {
  test('deletes mapping and removes worktree + branch (best-effort)', async () => {
    const repo = tmpGitRepo();
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
    const repo = tmpGitRepo();
    const { deps, kv } = makeDeps();
    await createSessionWithWorktree(deps, { directory: repo, worktree: 'boom' });
    // 破坏：把映射指向不存在的 worktree 目录
    kv.set('session-worktree/sess-1', { dir: path.join(os.tmpdir(), 'definitely-missing-wt'), branch: 'mafw/boom', projectDir: repo });
    await expect(cleanupWorktreeForSession(deps, 'sess-1')).resolves.toBeUndefined();
    expect(kv.has('session-worktree/sess-1')).toBe(false);
  });
});
