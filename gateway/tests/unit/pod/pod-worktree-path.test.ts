import * as os from 'os';
import * as path from 'path';
import {
  podWorktreeBranch,
  podWorktreeDir,
  safePodGoalSlug,
} from '../../../src/core/pod/pod-worktree-path';

describe('pod worktree path rules', () => {
  test('sanitizes path separators and traversal-looking goal ids', () => {
    const slug = safePodGoalSlug('../goal/2026-11-09');
    expect(slug).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('\\');
    expect(slug).not.toBe('.');
    expect(slug).not.toBe('..');
  });

  test('keeps safe goal ids readable', () => {
    expect(safePodGoalSlug('goal-20261109_31c1a0')).toBe('goal-20261109_31c1a0');
  });

  test('never returns an empty slug', () => {
    expect(safePodGoalSlug('')).not.toBe('');
    expect(safePodGoalSlug('///')).not.toBe('');
  });

  test('branch is revision scoped', () => {
    expect(podWorktreeBranch('goal-20261109-31c1a0', 2)).toBe('mafw/goal-20261109-31c1a0-r2');
  });

  test('directory is a sibling of the repo root with the -wt- marker', () => {
    const repo = path.join(os.tmpdir(), 'mafw-worktree-path', 'repo');
    const dir = podWorktreeDir(repo, 'goal-20261109-31c1a0', 1);
    expect(path.dirname(dir)).toBe(path.dirname(path.resolve(repo)));
    expect(path.basename(dir)).toBe('repo-wt-goal-20261109-31c1a0-r1');
  });
});
