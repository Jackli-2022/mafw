// gateway/tests/unit/archive-goal-wiring.test.ts
// 归档模块接线回归钉扎：archiveWorktree 已是 gateway 同包模块
// （src/core/tools/archive-worktree.ts），必须静态 import——动态 loadArchiveModule
// 指向已删除的 v1 插件路径（根 dist/tools），生产环境每次归档必炸
// （native import() 对 Windows 绝对路径还要 file:// URL，双重坑）。
import { readFileSync } from 'fs';
import * as path from 'path';

const INDEX = path.resolve(__dirname, '../../src/index.ts');
const src = readFileSync(INDEX, 'utf-8');

describe('archiveGoal 模块接线（archive_failed 根因回归）', () => {
  it('index.ts 静态 import archiveWorktree（同包模块）', () => {
    expect(src).toMatch(/import\s*\{[^}]*archiveWorktree[^}]*\}\s*from\s*['"]\.\/core\/tools\/archive-worktree\.js['"]/);
  });

  it('死代码 loadArchiveModule 与 v1 插件路径已删除', () => {
    expect(src).not.toContain('loadArchiveModule');
    expect(src).not.toContain("dist', 'tools', 'archive-worktree");
  });

  it('模块本体可静态导入且导出形状正确', async () => {
    const mod = await import('../../src/core/tools/archive-worktree.js');
    expect(typeof mod.archiveWorktree).toBe('function');
    expect(typeof mod.mergeMemoryFromWorktree).toBe('function');
  });
});
