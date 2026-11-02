// 共享测试 helper：真实 tmp git 仓库（worktree 相关路线/门共用）。
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export function tmpGitRepo(prefix = 'mafw-wt-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execSync('git init -b main', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email t@t && git config user.name t', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  execSync('git add . && git commit -m init', { cwd: dir, stdio: 'ignore' });
  return dir;
}
