"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskBranchManager = void 0;
const simple_git_1 = __importDefault(require("simple-git"));
/**
 * Task Branch Manager — Task 级 Git 分支隔离
 *
 * 职责：
 *   1. 为每个 Task 创建独立 Git 分支（change/{taskId}）
 *   2. 基于 Goal 分支创建 Task 分支
 *   3. Task 完成后合并回 Goal 分支
 *   4. 删除 Task 分支
 *
 * 设计原则：
 *   - Task 分支从 Goal 分支切出
 *   - 多个 Task 可以在各自的 change/{taskId} 分支上并行开发
 *   - Task 完成后合并回 Goal 分支，然后删除 Task 分支
 */
class TaskBranchManager {
    /**
     * 创建 Task 分支
     */
    async createTaskBranch(worktreeDir, taskId, baseBranch) {
        const git = (0, simple_git_1.default)(worktreeDir);
        const branch = `change/${taskId}`;
        // 先切换到 base branch
        await git.checkout(baseBranch);
        // 创建并切换 Task 分支
        const branches = await git.branchLocal();
        if (!branches.all.includes(branch)) {
            await git.checkoutLocalBranch(branch);
            console.log(`[TaskBranch] Created branch ${branch} from ${baseBranch}`);
        }
        else {
            await git.checkout(branch);
            console.log(`[TaskBranch] Checked out existing branch ${branch}`);
        }
        return branch;
    }
    /**
     * 合并 Task 分支回 Goal 分支
     */
    async mergeTaskBranch(worktreeDir, taskId) {
        const git = (0, simple_git_1.default)(worktreeDir);
        const branch = `change/${taskId}`;
        const goalBranch = await this.getCurrentBranch(worktreeDir);
        // 切换回 Goal 分支
        await git.checkout(goalBranch);
        // 合并 Task 分支
        try {
            await git.merge([branch, '--no-ff', '-m', `Merge task ${taskId}`]);
            console.log(`[TaskBranch] Merged ${branch} into ${goalBranch}`);
        }
        catch (err) {
            console.error(`[TaskBranch] Merge conflict in ${branch}:`, err.message);
            await git.merge(['--abort']);
            throw new Error(`Task merge conflict: ${taskId}`);
        }
        // 删除 Task 分支
        await git.raw(['branch', '-D', branch]);
        console.log(`[TaskBranch] Deleted branch ${branch}`);
    }
    /**
     * 获取当前分支
     */
    async getCurrentBranch(worktreeDir) {
        const git = (0, simple_git_1.default)(worktreeDir);
        const result = await git.revparse(['--abbrev-ref', 'HEAD']);
        return result.trim();
    }
    /**
     * 批量合并 Task 分支（Wave 完成后）
     */
    async mergeTaskBranches(worktreeDir, taskIds) {
        for (const taskId of taskIds) {
            try {
                await this.mergeTaskBranch(worktreeDir, taskId);
            }
            catch (err) {
                console.error(`[TaskBranch] Failed to merge task ${taskId}: ${err.message}`);
                // 继续合并其他 task，不中断
            }
        }
    }
    /**
     * 清理所有 Task 分支
     */
    async cleanupAllTaskBranches(worktreeDir) {
        const git = (0, simple_git_1.default)(worktreeDir);
        const branches = await git.branchLocal();
        const taskBranches = branches.all.filter((b) => b.startsWith('change/'));
        for (const branch of taskBranches) {
            await git.raw(['branch', '-D', branch]);
            console.log(`[TaskBranch] Cleaned up ${branch}`);
        }
    }
}
exports.TaskBranchManager = TaskBranchManager;
//# sourceMappingURL=task-branch-manager.js.map