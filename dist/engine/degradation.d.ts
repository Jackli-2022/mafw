/**
 * Degradation Strategy — 五级降级策略
 *
 * L1: 警告 — Loop 3/5 提示用户，不停止
 * L2: 降级 — Loop 5/5 自动降级完成部分工作
 * L3: 熔断 — 连续 3 轮相同 Lesson 强制退出
 * L4: 紧急 — 心跳超时，从 Checkpoint 恢复
 * L5: 灾难 — 外部依赖失败，优雅失败
 */
export declare class DegradationStrategy {
    private projectDir;
    private reportGenerator;
    constructor(projectDir?: string);
    /**
     * 判断是否需要 L1 警告
     */
    shouldWarn(loopCount: number, maxLoops: number): boolean;
    /**
     * L1 警告处理：提示用户选择
     */
    handleL1(goalId: string, loopCount: number, reviewResult: any): Promise<string>;
    /**
     * L2 降级：自动执行
     */
    autoDegrade(goalId: string, executeResult: any): Promise<void>;
    /**
     * L2 降级：接受部分完成
     */
    degradeToPartial(goalId: string, executeResult: any): Promise<void>;
    /**
     * L3 熔断检测：连续 3 轮相同原因
     */
    checkL3Oscillation(goalId: string, lessons: {
        reason: string;
    }[]): Promise<boolean>;
    /**
     * L4 紧急：从 Checkpoint 恢复
     */
    recoverFromCheckpoint(goalId: string, checkpointPath: string): Promise<void>;
    /**
     * L5 灾难：导出记忆到外部 Git 分支
     */
    exportForDisaster(goalId: string): Promise<string>;
}
//# sourceMappingURL=degradation.d.ts.map