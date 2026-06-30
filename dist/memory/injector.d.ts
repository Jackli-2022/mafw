import { Delta, InjectionResult } from '../types/parametric';
/**
 * Delta Injector — L3 参数注入器
 *
 * 职责：将匹配的 Δ 按优先级注入到 Agent 的 System Prompt 中。
 *
 * 注入规则：
 *   1. 按 priority DESC → energy_score DESC 排序
 *   2. 硬截断：最多 5 个 Δ，总 token ≤ 800
 *   3. 三种前缀：
 *      [C-N] constraint-delta (HARD)
 *      [P-N] prompt-delta (SOFT)
 *      [P-N] pattern-delta (PATTERN)
 *   4. 防污染：Agent 输出若包含 [C- 或 [P- 标记，视为违规
 *
 * 注入格式示例：
 *   [PARAMETRIC MEMORY ACTIVE — 3 deltas injected]
 *   [C-1] review-coverage-v2 (HARD): 测试覆盖率低于 80% 的代码必须...
 *   [P-1] wave-decomposition-auth-v1 (PATTERN): Wave 1(契约层)→...
 */
export declare class DeltaInjector {
    private readonly MAX_DELTA_COUNT;
    private readonly MAX_TOKENS;
    /**
     * 从 ParametricStore 取出匹配的 Δ，排序并截断，生成注入文本。
     */
    inject(deltas: Delta[]): InjectionResult;
    /**
     * 将注入结果渲染为注入文本块。
     */
    render(injection: InjectionResult): string;
    /**
     * 防污染检测：检查 Agent 输出是否泄露了 [C- 或 [P- 标记。
     */
    checkPollution(agentOutput: string): {
        clean: boolean;
        violations: string[];
    };
    /**
     * 简单 token 估算（1 token ≈ 0.75 英文单词，或 ≈ 1 中文字符）
     */
    private estimateTokens;
}
//# sourceMappingURL=injector.d.ts.map