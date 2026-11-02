// worktree 归属（设计 §7.1）：worktree 是 gateway 自己的 git 工作区能力，
// 由「本地 git 可用性 + runtime 的 session.create({directory}) 契约」共同决定，
// 不再由 runtime 的 worktreeApi 能力位决定。
import * as os from 'os';
import * as path from 'path';
import { resolveWorktreeAvailability } from '../../../src/core/worktree/worktree-availability';

describe('resolveWorktreeAvailability', () => {
  const repo = path.join(os.tmpdir(), 'mafw-wt-availability-repo');

  it('supports worktrees when directory sessions and git are both available', () => {
    expect(
      resolveWorktreeAvailability({ directory: repo, directorySupported: true, gitAvailable: true }),
    ).toEqual({ supported: true });
  });

  it('reports missing-data when the directory is not a git repository', () => {
    expect(
      resolveWorktreeAvailability({ directory: '/tmp', directorySupported: true, gitAvailable: false }),
    ).toEqual({ supported: false, reason: 'missing-data' });
  });

  it('reports missing-data when no directory was resolved', () => {
    expect(
      resolveWorktreeAvailability({ directory: '   ', directorySupported: true, gitAvailable: true }),
    ).toEqual({ supported: false, reason: 'missing-data' });
  });

  it('reports unsupported when the runtime cannot create directory-scoped sessions', () => {
    expect(
      resolveWorktreeAvailability({ directory: repo, directorySupported: false, gitAvailable: true }),
    ).toEqual({ supported: false, reason: 'unsupported' });
  });

  it('prefers unsupported over missing-data when both inputs are absent', () => {
    expect(
      resolveWorktreeAvailability({ directory: '', directorySupported: false, gitAvailable: false }),
    ).toEqual({ supported: false, reason: 'unsupported' });
  });
});
