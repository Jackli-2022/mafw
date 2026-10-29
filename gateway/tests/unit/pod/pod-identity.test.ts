import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  canonicalProjectDir,
  parentProjectDirForWorktree,
  podIdForProject,
  roleForNode,
} from '../../../src/core/pod/pod-identity';

describe('pod identity', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-id-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('canonicalProjectDir returns a real path', () => {
    expect(canonicalProjectDir(dir)).toBe(fs.realpathSync(dir));
  });

  test('podIdForProject is stable across case and slash spelling', () => {
    const id = podIdForProject(dir);
    expect(id).toMatch(/^pod_[0-9a-f]{12}$/);
    if (process.platform === 'win32') {
      expect(podIdForProject(dir.toUpperCase())).toBe(id);
      expect(podIdForProject(dir.replace(/\\/g, '/'))).toBe(id);
    }
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-id-other-'));
    try {
      expect(podIdForProject(other)).not.toBe(id);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test('parentProjectDirForWorktree maps a worktree to its parent', () => {
    const worktree = path.join('/repo', 'foo-wt-feature');
    expect(parentProjectDirForWorktree(worktree)).toBe(path.join('/repo', 'foo'));
    expect(parentProjectDirForWorktree(path.join('/repo', 'foo'))).toBeNull();
  });

  test('roleForNode maps goal nodes to pod roles', () => {
    expect(roleForNode('plan')).toBe('lead');
    expect(roleForNode('execute')).toBe('builder');
    expect(roleForNode('review')).toBe('reviewer');
  });
});
