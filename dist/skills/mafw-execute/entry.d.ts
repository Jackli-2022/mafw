import { TaskBranchManager } from '../../engine/task-branch-manager';
/**
 * mafw-execute Skill Entry — Execute Agent（独立 Session）
 *
 * 【关键】状态更新是主路径，写在函数末尾
 *
 * 职责：
 *   1. 读取 waves.json
 *   2. Wave 1: Task 并行执行（各自 Git 分支）
 *   3. 每个 Task: 调用 LLM 编写代码，写入文件，git commit
 *   4. 合并 Wave → goal/{goalId}
 *   5. Wave 2+: 重复
 *   6. 远程 CLI 同步（如果配置）
 *   7. 写入 receipts/{goalId}/
 *   8. 【显式】更新 state.json → nextAction: CREATE_REVIEW_SESSION
 *
 * 调用方式：Scheduler 创建 Execute Session → 发送 /skill mafw-execute {goalId}
 */
export interface ExecuteSkillContext {
    message: string;
    llm: {
        chat: (options: {
            model: string;
            messages: any[];
        }) => Promise<{
            content: string;
        }>;
    };
    config: {
        model: string;
    };
    sessionId: string;
}
export declare function mafwExecuteEntry(context: ExecuteSkillContext): Promise<void>;
export declare function mergeWaveToGoal(wave: any, worktreeDir: string, taskBranchManager: TaskBranchManager, taskResults: any[]): Promise<{
    merged: string[];
    failed: string[];
    status: string;
}>;
//# sourceMappingURL=entry.d.ts.map