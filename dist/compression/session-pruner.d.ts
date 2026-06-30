import { WaveDigest, TokenBudgetConfig } from '../types/compression';
/**
 * Session Pruner — L1 实时剪枝器
 *
 * 职责：Session 过长时自动压缩历史内容，保留当前 Wave 完整上下文。
 *
 * 策略（从文档 §3.1 提取）：
 *   ┌──────────────┬─────────────┬──────────────┬────────────┐
 *   │ 内容类型      │ 当前 Wave   │ 已完成 Wave  │ 处理方式   │
 *   ├──────────────┼─────────────┼──────────────┼────────────┤
 *   │ System Prompt │ 完整保留    │ 完整保留    │ 不可压缩   │
 *   │ Parametric Δ  │ 完整保留    │ 完整保留    │ 不可压缩   │
 *   │ Task 定义     │ 完整保留    │ 摘要        │ 保留ID+状态│
 *   │ 代码编辑      │ 完整保留    │ 摘要        │ 保留路径   │
 *   │ 工具输出      │ 完整保留    │ 截断        │ 最后10行   │
 *   │ 对话历史      │ 完整保留    │ 压缩        │ Wave摘要   │
 *   │ 成功测试日志  │ 完整保留    │ 丢弃        │ 只保留标记 │
 *   │ 失败测试日志  │ 完整保留    │ 完整保留    │ 不压缩     │
 *   └──────────────┴─────────────┴──────────────┴────────────┘
 *
 * 触发条件：Session 达到 6000 tokens (75% 压缩阈值) 时触发
 */
export declare class SessionPruner {
    private config;
    constructor(config?: Partial<TokenBudgetConfig>);
    /**
     * 检查是否需要剪枝
     */
    shouldPrune(currentTokens: number): boolean;
    /**
     * 执行剪枝：将已完成 Wave 的内容压缩为摘要
     */
    prune(session: any[], currentWaveId: string, completedDigests: WaveDigest[]): any[];
    /**
     * 压缩单个 Session 条目
     */
    private compressItem;
    /**
     * 工具输出截断：保留最后 N 行
     */
    private truncateToolOutput;
    /**
     * 渲染 Wave 摘要卡片
     */
    private renderDigests;
    /**
     * 粗略 token 估算
     */
    private estimateTokens;
}
//# sourceMappingURL=session-pruner.d.ts.map