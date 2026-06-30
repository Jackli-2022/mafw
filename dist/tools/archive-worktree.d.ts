/**
 * Archive Worktree Tool — Archive tool 函数
 *
 * 职责：
 *   1. 合并 Goal 分支到 main
 *   2. 生成报告
 *   3. 更新 STATUS.md
 *   4. 清理临时资源
 *
 * 被 Scheduler 在 ARCHIVE 阶段调用。
 */
export interface ArchiveContext {
    goalId: string;
    projectDir: string;
    loopCount: number;
}
/**
 * 执行 Archive 流程
 */
export declare function archiveWorktree(context: ArchiveContext): Promise<void>;
//# sourceMappingURL=archive-worktree.d.ts.map