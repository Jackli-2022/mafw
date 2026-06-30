import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import simpleGit from 'simple-git';
import { TaskBranchManager } from '../../../src/engine/task-branch-manager';

let tmpDir: string;
let repoDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-tb-'));
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoDir);
  const git = simpleGit(repoDir);
  await git.init();
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a');
  await git.add('a.txt');
  await git.commit('init');
  await git.checkoutLocalBranch('main');
  await git.checkoutLocalBranch('goal/001-auth');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('createTaskBranch creates change/{taskId}', async () => {
  const mgr = new TaskBranchManager();
  const branch = await mgr.createTaskBranch(repoDir, '001-1', 'goal/001-auth');
  expect(branch).toBe('change/001-1');
  const current = await simpleGit(repoDir).revparse(['--abbrev-ref', 'HEAD']);
  expect(current.trim()).toBe('change/001-1');
});

test('mergeTaskBranch merges back and deletes task branch', async () => {
  const mgr = new TaskBranchManager();
  await mgr.createTaskBranch(repoDir, '001-1', 'goal/001-auth');
  fs.writeFileSync(path.join(repoDir, 'b.txt'), 'b');
  const git = simpleGit(repoDir);
  await git.add('b.txt');
  await git.commit('task 001-1');
  await mgr.mergeTaskBranch(repoDir, '001-1');
  const current = await git.revparse(['--abbrev-ref', 'HEAD']);
  expect(current.trim()).toBe('goal/001-auth');
  const branches = await git.branchLocal();
  expect(branches.all).not.toContain('change/001-1');
});
