// 会话级 worktree 管理（切片 4）：`git worktree add <project>-wt-<slug> -b mafw/<slug>`。
// 命名约定与 GoalWorktreeManager 的 `<proj>-goal-<id>` 平铺风格一致（项目同级目录）。
// 刻意不复用 GoalWorktreeManager.prepare——其非并行路径会 checkout 切走主仓分支，
// 与"并行隔离"目标相悖。幂等：目录+分支已是既有 worktree 则复用；分支被检出但目录
// 不同（或反之）→ slug 递增 -2/-3。映射与清理联动在 index.ts（kv session-worktree/<sid>）。
import * as fs from 'fs';
import * as path from 'path';
import { simpleGit } from 'simple-git';

export interface WorktreeRef {
  worktreeDir: string;
  branch: string;
}

export class SessionWorktreeManager {
  // 注意：不能用字段初始化器 `git = simpleGit(this.projectDir)`——TS 类字段初始化
  // 先于 constructor 参数属性赋值执行，projectDir 此时是 undefined，simple-git 会
  // 回退到 process.cwd()（gateway 自身 repo）导致 worktree 全部注册错仓库。
  private git: ReturnType<typeof simpleGit>;

  constructor(private projectDir: string) {
    this.git = simpleGit(projectDir);
  }

  private dirFor(slug: string): string {
    return path.join(path.dirname(this.projectDir), `${path.basename(this.projectDir)}-wt-${slug}`);
  }

  /** 命名约定内的 worktree（`-wt-` 中缀 + `mafw/` 分支）。 */
  async list(): Promise<Array<{ path: string; branch: string }>> {
    const raw = await this.git.raw(['worktree', 'list', '--porcelain']);
    const out: Array<{ path: string; branch: string }> = [];
    let curPath = '';
    let curBranch = '';
    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) curPath = line.slice('worktree '.length).trim();
      else if (line.startsWith('branch ')) curBranch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      else if (line === '' && curPath) {
        const base = curPath.replace(/\\/g, '/').split('/').pop() ?? '';
        if (base.includes('-wt-') && curBranch.startsWith('mafw/')) out.push({ path: curPath, branch: curBranch });
        curPath = '';
        curBranch = '';
      }
    }
    return out;
  }

  async create(slug?: string): Promise<WorktreeRef> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const auto = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    let name = slug?.trim() || `wt-${auto}`;

    // 命名约定语义：同名 slug 一律递增（-2/-3…）——每个会话应有独立 worktree，
    // 不做跨调用幂等复用（复用会让两个会话共享同一隔离副本，违背目标）。
    const existing = await this.list();
    const taken = (candidate: string) =>
      existing.some((w) => w.branch === `mafw/${candidate}`) || fs.existsSync(this.dirFor(candidate));
    if (taken(name)) {
      for (let i = 2; ; i++) {
        if (!taken(`${name}-${i}`)) { name = `${name}-${i}`; break; }
      }
    }

    const worktreeDir = this.dirFor(name);
    const branch = `mafw/${name}`;
    await this.git.raw(['worktree', 'add', worktreeDir, '-b', branch]);
    return { worktreeDir, branch };
  }

  async remove(worktreeDir: string, branch?: string): Promise<void> {
    try {
      await this.git.raw(['worktree', 'remove', '--force', worktreeDir]);
    } catch {
      // 目录可能已被外部清理；prune 掉悬空记录后继续
      await this.git.raw(['worktree', 'prune']).catch(() => {});
    }
    if (branch) {
      await this.git.branch(['-D', branch]).catch(() => { /* 分支可能已删/被占用，fail-open */ });
    }
  }
}
