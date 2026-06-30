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
    worktreeDir: string;
    branch: string;
    isIsolated: boolean;
}
export declare class GoalWorktreeManager {
    private projectDir;
    private git;
    constructor(projectDir?: string);
    /**
     * 准备 Goal 的 Worktree
     */
    prepare(config: {
        projectDir: string;
        goalId: string;
        parallel: boolean;
    }): Promise<WorktreeInfo>;
    /**
     * 归档 Goal（合并到 main）
     */
    archive(info: WorktreeInfo, strategy?: 'merge' | 'squash'): Promise<void>;
    /**
     * 获取当前 Goal 分支信息
     */
    getCurrentInfo(goalId: string): Promise<WorktreeInfo>;
    /**
     * 检查分支是否存在
     */
    branchExists(branch: string): Promise<boolean>;
}
//# sourceMappingURL=goal-worktree-manager.d.ts.map