import { log } from '../utils/logger';
import simpleGit from 'simple-git';

/**
 * Task Branch Manager — Task 级 Git 分支隔离
 *
 * 鑱岃矗锛?
 *   1. 为每个 Task 创建独立 Git 分支（change/{taskId}）
 *   2. 基于 Goal 分支创建 Task 分支
 *   3. Task 完成后合并回 Goal 分支
 *   4. 删除 Task 分支
 *
 * 设计原则：
 *   - Task 鍒嗘敮浠?Goal 鍒嗘敮鍒囧嚭
 *   - 多个 Task 可以在各自的 change/{taskId} 分支上并行开发
 *   - Task 瀹屾垚鍚庡悎骞跺洖 Goal 鍒嗘敮锛岀劧鍚庡垹闄?Task 鍒嗘敮
 */

export class TaskBranchManager {
  private baseBranches = new Map<string, string>();

  /**
   * 创建 Task 分支
   */
  async createTaskBranch(worktreeDir: string, taskId: string, baseBranch: string): Promise<string> {
    const git = simpleGit(worktreeDir);
    const branch = `change/${taskId}`;

    // 先切换到 base branch
    await git.checkout(baseBranch);

    // 鍒涘缓骞跺垏鎹?Task 鍒嗘敮
    const branches = await git.branchLocal();
    if (!branches.all.includes(branch)) {
      await git.checkoutLocalBranch(branch);
    } else {
      await git.checkout(branch);
    }

    this.baseBranches.set(`${worktreeDir}::${taskId}`, baseBranch);
    return branch;
  }

  /**
   * 鍚堝苟 Task 鍒嗘敮鍥?Goal 鍒嗘敮
   */
  async mergeTaskBranch(worktreeDir: string, taskId: string): Promise<void> {
    const git = simpleGit(worktreeDir);
    const branch = `change/${taskId}`;
    const goalBranch = this.baseBranches.get(`${worktreeDir}::${taskId}`) || await this.getCurrentBranch(worktreeDir);

    // 鍒囨崲鍥?Goal 鍒嗘敮
    await git.checkout(goalBranch);

    // 合并 Task 分支
    try {
      await git.merge([branch, '--no-ff', '-m', `Merge task ${taskId}`]);
      log.info(`[TaskBranch] Merged ${branch} into ${goalBranch}`);
    } catch (err: any) {
      log.error(`[TaskBranch] Merge conflict in ${branch}:`, err.message);
      await git.merge(['--abort']);
      throw new Error(`Task merge conflict: ${taskId}`);
    }

    // 删除 Task 分支
    await git.raw(['branch', '-D', branch]);
    log.info(`[TaskBranch] Deleted branch ${branch}`);
  }

  /**
   * 获取当前分支
   */
  async getCurrentBranch(worktreeDir: string): Promise<string> {
    const git = simpleGit(worktreeDir);
    const result = await git.revparse(['--abbrev-ref', 'HEAD']);
    return result.trim();
  }

  /**
   * 批量合并 Task 分支（Wave 完成后）
   */
  async mergeTaskBranches(worktreeDir: string, taskIds: string[]): Promise<void> {
    for (const taskId of taskIds) {
      try {
        await this.mergeTaskBranch(worktreeDir, taskId);
      } catch (err: any) {
        log.error(`[TaskBranch] Failed to merge task ${taskId}: ${err.message}`);
        // 继续合并其他 task，不中断
      }
    }
  }

  /**
   * 娓呯悊鎵€鏈?Task 鍒嗘敮
   */
  async cleanupAllTaskBranches(worktreeDir: string): Promise<void> {
    const git = simpleGit(worktreeDir);
    const branches = await git.branchLocal();
    const taskBranches = branches.all.filter((b: string) => b.startsWith('change/'));

    for (const branch of taskBranches) {
      await git.raw(['branch', '-D', branch]);
      log.info(`[TaskBranch] Cleaned up ${branch}`);
    }
  }
}



