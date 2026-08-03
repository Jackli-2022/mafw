import { log } from '../utils/logger';
import simpleGit from 'simple-git';

/**
 * Task Branch Manager 鈥?Task 绾?Git 鍒嗘敮闅旂
 *
 * 鑱岃矗锛?
 *   1. 涓烘瘡涓?Task 鍒涘缓鐙珛 Git 鍒嗘敮锛坈hange/{taskId}锛?
 *   2. 鍩轰簬 Goal 鍒嗘敮鍒涘缓 Task 鍒嗘敮
 *   3. Task 瀹屾垚鍚庡悎骞跺洖 Goal 鍒嗘敮
 *   4. 鍒犻櫎 Task 鍒嗘敮
 *
 * 璁捐鍘熷垯锛?
 *   - Task 鍒嗘敮浠?Goal 鍒嗘敮鍒囧嚭
 *   - 澶氫釜 Task 鍙互鍦ㄥ悇鑷殑 change/{taskId} 鍒嗘敮涓婂苟琛屽紑鍙?
 *   - Task 瀹屾垚鍚庡悎骞跺洖 Goal 鍒嗘敮锛岀劧鍚庡垹闄?Task 鍒嗘敮
 */

export class TaskBranchManager {
  private baseBranches = new Map<string, string>();

  /**
   * 鍒涘缓 Task 鍒嗘敮
   */
  async createTaskBranch(worktreeDir: string, taskId: string, baseBranch: string): Promise<string> {
    const git = simpleGit(worktreeDir);
    const branch = `change/${taskId}`;

    // 鍏堝垏鎹㈠埌 base branch
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

    // 鍚堝苟 Task 鍒嗘敮
    try {
      await git.merge([branch, '--no-ff', '-m', `Merge task ${taskId}`]);
      log.info(`[TaskBranch] Merged ${branch} into ${goalBranch}`);
    } catch (err: any) {
      log.error(`[TaskBranch] Merge conflict in ${branch}:`, err.message);
      await git.merge(['--abort']);
      throw new Error(`Task merge conflict: ${taskId}`);
    }

    // 鍒犻櫎 Task 鍒嗘敮
    await git.raw(['branch', '-D', branch]);
    log.info(`[TaskBranch] Deleted branch ${branch}`);
  }

  /**
   * 鑾峰彇褰撳墠鍒嗘敮
   */
  async getCurrentBranch(worktreeDir: string): Promise<string> {
    const git = simpleGit(worktreeDir);
    const result = await git.revparse(['--abbrev-ref', 'HEAD']);
    return result.trim();
  }

  /**
   * 鎵归噺鍚堝苟 Task 鍒嗘敮锛圵ave 瀹屾垚鍚庯級
   */
  async mergeTaskBranches(worktreeDir: string, taskIds: string[]): Promise<void> {
    for (const taskId of taskIds) {
      try {
        await this.mergeTaskBranch(worktreeDir, taskId);
      } catch (err: any) {
        log.error(`[TaskBranch] Failed to merge task ${taskId}: ${err.message}`);
        // 缁х画鍚堝苟鍏朵粬 task锛屼笉涓柇
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



