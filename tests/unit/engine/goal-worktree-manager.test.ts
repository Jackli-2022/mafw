import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { GoalWorktreeManager } from '../../../gateway/src/core/engine/goal-worktree-manager';

let tmpDir: string;
let repoDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-wt-'));
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir);
  const git = simpleGit(repoDir);
  await git.init();
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# init');
  await git.add('README.md');
  await git.commit('init');
  await git.checkoutLocalBranch('main');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('prepare non-parallel creates goal branch', async () => {
  const mgr = new GoalWorktreeManager(repoDir);
  const info = await mgr.prepare({ projectDir: repoDir, goalId: '001-auth', parallel: false });
  expect(info.branch).toBe('goal/001-auth');
  expect(info.isIsolated).toBe(false);
  const current = await simpleGit(repoDir).revparse(['--abbrev-ref', 'HEAD']);
  expect(current.trim()).toBe('goal/001-auth');
});
