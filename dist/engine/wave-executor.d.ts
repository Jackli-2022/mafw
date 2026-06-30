/**
 * Wave Executor — Wave 调度 + Task 并行执行器 (v2.1)
 *
 * 按 Goal 隔离：所有 Wave/Task 在同一个 Goal 分支上执行。
 * 不再为每个 Task 创建独立分支。
 *
 * 职责：
 *   1. 串行执行 Wave（Wave 间有依赖）
 *   2. 每个 Wave 内并行执行 Task（共享同一个 Goal 分支）
 *   3. 工具输出 > 1000 tokens 时截断
 */
export declare class WaveExecutor {
    private projectDir;
    constructor(projectDir?: string);
    run(waves: any[], goalId: string, loopCount: number): Promise<any>;
    private executeWave;
    private executeTask;
    /**
     * L1 实时：工具输出截断
     */
    private truncateToolOutputs;
    private createDigest;
    private collectFilesChanged;
    /**
     * Goal 完成后合并到 main
     */
    mergeToMain(goalId: string): Promise<void>;
}
//# sourceMappingURL=wave-executor.d.ts.map