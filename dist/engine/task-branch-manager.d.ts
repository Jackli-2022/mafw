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
export declare class TaskBranchManager {
    /**
     * 创建 Task 分支
     */
    createTaskBranch(worktreeDir: string, taskId: string, baseBranch: string): Promise<string>;
    /**
     * 合并 Task 分支回 Goal 分支
     */
    mergeTaskBranch(worktreeDir: string, taskId: string): Promise<void>;
    /**
     * 获取当前分支
     */
    getCurrentBranch(worktreeDir: string): Promise<string>;
    /**
     * 批量合并 Task 分支（Wave 完成后）
     */
    mergeTaskBranches(worktreeDir: string, taskIds: string[]): Promise<void>;
    /**
     * 清理所有 Task 分支
     */
    cleanupAllTaskBranches(worktreeDir: string): Promise<void>;
}
//# sourceMappingURL=task-branch-manager.d.ts.map