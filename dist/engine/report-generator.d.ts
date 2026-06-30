/**
 * Report Generator — 执行报告生成器
 *
 * 职责：
 *   1. Goal 成功完成时生成成功报告
 *   2. 降级完成时生成降级报告
 *   3. Archive 阶段调用 L3 Validator
 *
 * 输出：.opencode/mafw/reports/{goal_id}.md
 */
export declare class ReportGenerator {
    private reportsDir;
    constructor(projectDir?: string);
    /**
     * 生成成功报告
     */
    generate(goalId: string, data: {
        loopCount: number;
        executeResult: any;
        reviewResult: any;
    }): Promise<string>;
    /**
     * 生成降级报告
     */
    generateDegraded(goalId: string, data: {
        loopCount: number;
        reason: string;
        metrics: any;
    }): Promise<string>;
}
//# sourceMappingURL=report-generator.d.ts.map