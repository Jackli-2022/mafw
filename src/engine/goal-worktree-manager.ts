import simpleGit from 'simple-git';

/**
 * Goal Worktree Manager — Goal 级 Git Worktree 隔离
 *
 * 职责：
 *   1. 为每个 Goal 创建/准备 Git 分支（goal/{goalId}）
 *   2. 支持两种模式：
 *      - 非并行：在当前目录切换分支
 *      - 并行：创建独立 worktree 目录
 *   3. Goal 完成后合并到 main
 *   4. 清理独立 worktree
 *
 * 设计原则：
 *   - Goal 隔离在分支级别
 *   - Task 隔离在分支内继续用 change/{taskId} 分支
 *   - 默认非并行模式（简单，节省空间）
 */

export interface WorktreeInfo {
  worktreeDir: string;    // 实际工作目录
  branch: string;         // 分支名
  isIsolated: boolean;    // 是否独立 worktree
}

export class GoalWorktreeManager {
  private projectDir: string;
  private git: any;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.git = simpleGit(projectDir);
  }

  /**
   * 准备 Goal 的 Worktree
   */
  async prepare(config: { projectDir: string; goalId: string; parallel: boolean }): Promise<WorktreeInfo> {
    const { projectDir, goalId, parallel } = config;

    if (!parallel) {
      // 非并行模式：在当前目录切换分支
      const branch = `goal/${goalId}`;
      const branches = await this.git.branchLocal();
      if (!branches.all.includes(branch)) {
        await this.git.checkoutLocalBranch(branch);
        console.log(`[GoalWorktree] Created branch ${branch}`);
      } else {
        await this.git.checkout(branch);
        console.log(`[GoalWorktree] Checked out existing branch ${branch}`);
      }
      return { worktreeDir: projectDir, branch, isIsolated: false };
    }

    // 并行模式：创建独立 worktree
    const worktreeDir = `${projectDir}-goal-${goalId}`;
    const branch = `goal/${goalId}`;

    const branches = await this.git.branchLocal();
    if (!branches.all.includes(branch)) {
      await this.git.checkoutLocalBranch(branch);
    }

    // 创建 worktree
    try {
      await this.git.raw(['worktree', 'add', worktreeDir, branch]);
      console.log(`[GoalWorktree] Created worktree ${worktreeDir} for branch ${branch}`);
    } catch (err: any) {
      // 如果 worktree 已存在，直接返回
      console.log(`[GoalWorktree] Worktree ${worktreeDir} already exists`);
    }

    return { worktreeDir, branch, isIsolated: true };
  }

  /**
   * 归档 Goal（合并到 main）
   */
  async archive(info: WorktreeInfo, strategy: 'merge' | 'squash' = 'merge'): Promise<void> {
    console.log(`[GoalWorktree] Archiving goal ${info.branch}`);

    await this.git.checkout('main');

    if (strategy === 'merge') {
      try {
        await this.git.merge([info.branch, '--no-ff', '-m', `Merge goal ${info.branch}`]);
        console.log(`[GoalWorktree] Merged ${info.branch} into main`);
      } catch (err: any) {
        console.error(`[GoalWorktree] Merge conflict in ${info.branch}:`, err.message);
        await this.git.merge(['--abort']);
        throw new Error(`Merge conflict: ${info.branch}`);
      }
    } else {
      // Squash merge
      await this.git.merge([info.branch, '--squash', '-m', `Squash merge goal ${info.branch}`]);
      await this.git.commit(`Squash merge goal ${info.branch}`);
      console.log(`[GoalWorktree] Squash merged ${info.branch} into main`);
    }

    // 清理独立 worktree
    if (info.isIsolated) {
      try {
        await this.git.raw(['worktree', 'remove', info.worktreeDir]);
        await this.git.deleteBranch(info.branch);
        console.log(`[GoalWorktree] Removed worktree ${info.worktreeDir} and branch ${info.branch}`);
      } catch (err: any) {
        console.warn(`[GoalWorktree] Cleanup warning: ${err.message}`);
      }
    }
  }

  /**
   * 获取当前 Goal 分支信息
   */
  async getCurrentInfo(goalId: string): Promise<WorktreeInfo> {
    const branch = `goal/${goalId}`;
    const currentBranch = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    return {
      worktreeDir: this.projectDir,
      branch: currentBranch.trim(),
      isIsolated: false
    };
  }

  /**
   * 检查分支是否存在
   */
  async branchExists(branch: string): Promise<boolean> {
    const branches = await this.git.branchLocal();
    return branches.all.includes(branch);
  }
}
