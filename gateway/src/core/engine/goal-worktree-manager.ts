import { log } from '../utils/logger';
import simpleGit from 'simple-git';

/**
 * Goal Worktree Manager 鈥?Goal 绾?Git Worktree 闅旂
 *
 * 鑱岃矗锛?
 *   1. 涓烘瘡涓?Goal 鍒涘缓/鍑嗗 Git 鍒嗘敮锛坓oal/{goalId}锛?
 *   2. 鏀寔涓ょ妯″紡锛?
 *      - 闈炲苟琛岋細鍦ㄥ綋鍓嶇洰褰曞垏鎹㈠垎鏀?
 *      - 骞惰锛氬垱寤虹嫭绔?worktree 鐩綍
 *   3. Goal 瀹屾垚鍚庡悎骞跺埌 main
 *   4. 娓呯悊鐙珛 worktree
 *
 * 璁捐鍘熷垯锛?
 *   - Goal 闅旂鍦ㄥ垎鏀骇鍒?
 *   - Task 闅旂鍦ㄥ垎鏀唴缁х画鐢?change/{taskId} 鍒嗘敮
 *   - 榛樿闈炲苟琛屾ā寮忥紙绠€鍗曪紝鑺傜渷绌洪棿锛?
 */

export interface WorktreeInfo {
  worktreeDir: string;    // 瀹為檯宸ヤ綔鐩綍
  branch: string;         // 鍒嗘敮鍚?
  isIsolated: boolean;    // 鏄惁鐙珛 worktree
}

export class GoalWorktreeManager {
  private projectDir: string;
  private git: any;

  constructor(projectDir: string = '.') {
    this.projectDir = projectDir;
    this.git = simpleGit(projectDir);
  }

  /**
   * 鍑嗗 Goal 鐨?Worktree
   */
  async prepare(config: { projectDir: string; goalId: string; parallel: boolean }): Promise<WorktreeInfo> {
    const { projectDir, goalId, parallel } = config;

    if (!parallel) {
      // 闈炲苟琛屾ā寮忥細鍦ㄥ綋鍓嶇洰褰曞垏鎹㈠垎鏀?
      const branch = `goal/${goalId}`;
      const branches = await this.git.branchLocal();
      if (!branches.all.includes(branch)) {
        await this.git.checkoutLocalBranch(branch);
      }
      await this.git.checkout(branch);
      return { worktreeDir: projectDir, branch, isIsolated: false };
    }

    // 骞惰妯″紡锛氬垱寤虹嫭绔?worktree
    const worktreeDir = `${projectDir}-goal-${goalId}`;
    const branch = `goal/${goalId}`;

    const branches = await this.git.branchLocal();
    if (!branches.all.includes(branch)) {
      await this.git.checkoutLocalBranch(branch);
    }

    // 鍒涘缓 worktree
    try {
      await this.git.raw(['worktree', 'add', worktreeDir, branch]);
      log.info(`[GoalWorktree] Created worktree ${worktreeDir} for branch ${branch}`);
    } catch (err: any) {
      // 濡傛灉 worktree 宸插瓨鍦紝鐩存帴杩斿洖
      log.info(`[GoalWorktree] Worktree ${worktreeDir} already exists`);
    }

    return { worktreeDir, branch, isIsolated: true };
  }

  /**
   * 褰掓。 Goal锛堝悎骞跺埌 main锛?
   */
  async archive(info: WorktreeInfo, strategy: 'merge' | 'squash' = 'merge'): Promise<void> {
    log.info(`[GoalWorktree] Archiving goal ${info.branch}`);

    await this.git.checkout('main');

    if (strategy === 'merge') {
      try {
        await this.git.merge([info.branch, '--no-ff', '-m', `Merge goal ${info.branch}`]);
        log.info(`[GoalWorktree] Merged ${info.branch} into main`);
      } catch (err: any) {
        log.error(`[GoalWorktree] Merge conflict in ${info.branch}:`, err.message);
        await this.git.merge(['--abort']);
        throw new Error(`Merge conflict: ${info.branch}`);
      }
    } else {
      // Squash merge
      await this.git.merge([info.branch, '--squash', '-m', `Squash merge goal ${info.branch}`]);
      await this.git.commit(`Squash merge goal ${info.branch}`);
      log.info(`[GoalWorktree] Squash merged ${info.branch} into main`);
    }

    // 娓呯悊鐙珛 worktree
    if (info.isIsolated) {
      try {
        await this.git.raw(['worktree', 'remove', info.worktreeDir]);
        await this.git.deleteBranch(info.branch);
        log.info(`[GoalWorktree] Removed worktree ${info.worktreeDir} and branch ${info.branch}`);
      } catch (err: any) {
        log.warn(`[GoalWorktree] Cleanup warning: ${err.message}`);
      }
    }
  }

  /**
   * 鑾峰彇褰撳墠 Goal 鍒嗘敮淇℃伅
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
   * 妫€鏌ュ垎鏀槸鍚﹀瓨鍦?
   */
  async branchExists(branch: string): Promise<boolean> {
    const branches = await this.git.branchLocal();
    return branches.all.includes(branch);
  }

  /**
   * 鍒楀嚭鎵€鏈?git worktree
   */
  async listWorktrees(): Promise<Array<{ path: string; branch: string; head: string }>> {
    const output: string = await this.git.raw(['worktree', 'list']);
    const lines = output.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      const parts = line.split(/\s+/);
      return {
        path: parts[0],
        branch: (parts[1] || '').replace(/\[|\]/g, ''),
        head: parts[2] || '',
      };
    });
  }

  /**
   * 娓呯悊宸插垹闄ょ殑 worktree 璁板綍
   */
  async prune(): Promise<void> {
    try {
      await this.git.raw(['worktree', 'prune']);
      log.info('[GoalWorktree] Pruned stale worktree records');
    } catch (err: any) {
      log.warn(`[GoalWorktree] Prune warning: ${err.message}`);
    }
  }
}



