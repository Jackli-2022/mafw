import { TriggerCondition } from '../types/parametric';
/**
 * Matcher — TriggerCondition 匹配引擎
 *
 * 职责：将 Δ 的 trigger_condition 与当前执行上下文精确匹配。
 *
 * 支持的条件维度：
 *   - domain: 如 ['auth', 'api']
 *   - task_type: 如 ['coding', 'test']
 *   - affected_file_pattern: glob 模式，如 ['*.test.ts']
 *   - loop_stage: 如 ['planning', 'executing']
 *   - keywords: 关键词，Goal 描述中需包含
 *   - goal_keywords: 目标关键词，与 Goal Charter 匹配
 *   - min_loop_count: 最小 Loop 数（如 Loop 2+ 才触发）
 */
export declare class TriggerMatcher {
    /**
     * 判断 trigger_condition 是否匹配当前上下文
     */
    match(condition: TriggerCondition, context: {
        domain?: string;
        taskType?: string;
        loopStage?: string;
        loopCount?: number;
        goalKeywords?: string[];
        affectedFiles?: string[];
    }): boolean;
    /**
     * 简单 glob 匹配：*.test.ts → 正则
     */
    private globMatch;
}
//# sourceMappingURL=matcher.d.ts.map