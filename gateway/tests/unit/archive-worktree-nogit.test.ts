// gateway/tests/unit/archive-worktree-nogit.test.ts
// 非 git 项目目录跑 goal 是合法场景（临时/非代码项目）——归档必须优雅 no-op，
// 而不是 fatal: not a git repository → archive_failed 污染终态（verdict=PASS
// 照常但 nextAction 被写 FAILED）。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { archiveWorktree } from '../../src/core/tools/archive-worktree';

describe('archiveWorktree 非 git 目录 no-op', () => {
  it('非 git 项目目录 → 不抛错、不写任何产物', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-nogit-'));
    await expect(
      archiveWorktree({ goalId: 'g-nogit-1', projectDir: dir, loopCount: 1 }),
    ).resolves.toBeUndefined();
    // 目录内不应有归档副产物（STATUS.md 等）
    expect(fs.readdirSync(dir).filter((f) => f !== '.mafw')).toHaveLength(0);
  });
});
