// GoalWorktreeManager 防御性钉扎（2026-09-20）：
// 1) prepare(config.projectDir) ≠ constructor projectDir 时，git 操作必须落在
//    config.projectDir 的 repo（simpleGit cwd 重绑）——同类问题在 SessionWorktreeManager
//    曾因类字段初始化器时序踩坑（见 AGENTS §worktree 并行会话）。
// 2) archive merge 冲突时不留锁定态。
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GoalWorktreeManager } from '../../../src/core/engine/goal-worktree-manager';

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-gwt-'));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execSync('git add . && git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('GoalWorktreeManager', () => {
  test('prepare with mismatched projectDir registers worktree in config.projectDir repo', async () => {
    const repo = tmpRepo();
    const elsewhere = tmpRepo(); // constructor 绑定的目录（非目标 repo）
    const m = new GoalWorktreeManager(elsewhere);
    const info = await m.prepare({ projectDir: repo, goalId: 'g1', parallel: true });
    expect(info.isIsolated).toBe(true);
    // worktree 注册必须在 repo（config.projectDir），而非 elsewhere
    const inRepo = execSync('git worktree list', { cwd: repo }).toString();
    expect(inRepo).toContain(`-goal-g1`);
    const inElsewhere = execSync('git worktree list', { cwd: elsewhere }).toString();
    expect(inElsewhere).not.toContain('-goal-g1');
    expect(fs.existsSync(info.worktreeDir)).toBe(true);
  });

  test('prepare non-parallel: branch created in config.projectDir repo', async () => {
    const repo = tmpRepo();
    const elsewhere = tmpRepo();
    const m = new GoalWorktreeManager(elsewhere);
    const info = await m.prepare({ projectDir: repo, goalId: 'g2', parallel: false });
    expect(info.isIsolated).toBe(false);
    const branches = execSync('git branch --list goal/*', { cwd: repo }).toString();
    expect(branches).toContain('goal/g2');
  });
});
