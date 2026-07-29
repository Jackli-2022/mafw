/**
 * Archive Worktree Tool — Archive tool 函数
 *
 * 职责：
 *   1. 合并 Goal 分支到 main
 *   2. 从 worktree 提取独有记忆到主项目
 *   3. 生成报告
 *   4. 更新 STATUS.md
 *   5. 清理临时资源
 *
 * 被 Scheduler 在 ARCHIVE 阶段调用。
 */
export interface ArchiveContext {
    goalId: string;
    projectDir: string;
    loopCount: number;
}
export interface FusionResult {
    added: number;
    conflicts: number;
    fusionLog: boolean;
}
/**
 * 执行 Archive 流程
 */
export declare function archiveWorktree(context: ArchiveContext): Promise<void>;
/**
 * 从 worktree 提取独有记忆到主项目
 */
export declare function mergeMemoryFromWorktree(sourceDir: string, targetDir: string): Promise<FusionResult>;
//# sourceMappingURL=archive-worktree.d.ts.map