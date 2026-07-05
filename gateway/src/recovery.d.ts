/**
 * Recovery — 崩溃恢复器
 *
 * Scheduler 重启后：
 *   1. 读取 STATUS.md，找到所有 RUNNING 状态的 Goal
 *   2. 尝试找到最近的 Checkpoint
 *   3. 重新创建 session 并启动 Loop
 */
export declare class RecoveryManager {
    private projectDir;
    constructor(projectDir?: string);
    /**
     * 查找最近的 Checkpoint
     */
    findLastCheckpoint(goalId: string): string | null;
    /**
     * 保存 Checkpoint
     */
    saveCheckpoint(goalId: string, loop: number, data: any, waveNum?: number): void;
    /**
     * 加载 Checkpoint
     */
    loadCheckpoint(checkpointPath: string): any;
    restoreLoop(goalId: string, loop: number, targetWaveNum?: number): Promise<boolean>;
    /**
     * 恢复所有需要重启的 Goal
     */
    recoverAll(callback: (goalId: string, checkpoint: string | null) => Promise<void>): Promise<void>;
}
//# sourceMappingURL=recovery.d.ts.map