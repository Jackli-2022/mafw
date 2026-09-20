// SessionWorktreeManager：真实 tmp git 仓集成测试（worktree add 需 ≥1 commit）。
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionWorktreeManager } from '../../../src/core/engine/session-worktree-manager';

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-wt-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execSync('git add . && git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('SessionWorktreeManager', () => {
  test('create: worktree dir + mafw/<slug> branch, worktree file visible', async () => {
    const repo = tmpRepo();
    const m = new SessionWorktreeManager(repo);
    const { worktreeDir, branch } = await m.create('fix-api');
    expect(branch).toBe('mafw/fix-api');
    expect(path.basename(worktreeDir)).toBe(`${path.basename(repo)}-wt-fix-api`);
    expect(fs.existsSync(path.join(worktreeDir, 'a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(repo), path.basename(repo) + '-wt-fix-api'))).toBe(true);
  });

  test('create without slug → auto slug, still under naming convention', async () => {
    const repo = tmpRepo();
    const m = new SessionWorktreeManager(repo);
    const { worktreeDir, branch } = await m.create();
    expect(path.basename(worktreeDir)).toMatch(/-wt-wt-\d{8}-\d{6}$/);
    expect(branch).toMatch(/^mafw\/wt-\d{8}-\d{6}$/);
  });

  test('same slug twice → two independent worktrees (suffixed)', async () => {
    const repo = tmpRepo();
    const m = new SessionWorktreeManager(repo);
    const first = await m.create('dup');
    const second = await m.create('dup');
    expect(second.worktreeDir).not.toBe(first.worktreeDir);
    expect(second.branch).toBe('mafw/dup-2');
    expect(fs.existsSync(first.worktreeDir)).toBe(true);
    expect(fs.existsSync(second.worktreeDir)).toBe(true);
  });

  test('slug conflict with existing branch from another worktree → suffix -2', async () => {
    const repo = tmpRepo();
    const m = new SessionWorktreeManager(repo);
    const first = await m.create('shared');
    // 第二个 manager（同 repo）创建同名 slug：分支已检出 → 递增后缀
    const m2 = new SessionWorktreeManager(repo);
    const second = await m2.create('shared');
    expect(second.worktreeDir).not.toBe(first.worktreeDir);
    expect(second.branch).toBe('mafw/shared-2');
  });

  test('remove: worktree dir gone, branch deleted', async () => {
    const repo = tmpRepo();
    const m = new SessionWorktreeManager(repo);
    const { worktreeDir, branch } = await m.create('gone');
    await m.remove(worktreeDir, branch);
    expect(fs.existsSync(worktreeDir)).toBe(false);
    const branches = execSync('git branch --list mafw/*', { cwd: repo }).toString();
    expect(branches).not.toContain('mafw/gone');
  });

  test('list: only naming-convention worktrees of this manager', async () => {
    const repo = tmpRepo();
    const m = new SessionWorktreeManager(repo);
    await m.create('alpha');
    await m.create('beta');
    const list = await m.list();
    const names = list.map((l) => path.basename(l.path));
    expect(names.some((n) => n.endsWith('-wt-alpha'))).toBe(true);
    expect(names.some((n) => n.endsWith('-wt-beta'))).toBe(true);
    expect(list.every((l) => l.branch.startsWith('mafw/'))).toBe(true);
  });
});
