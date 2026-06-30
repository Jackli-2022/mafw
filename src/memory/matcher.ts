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
export class TriggerMatcher {
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
  }): boolean {
    // 1. min_loop_count
    if (condition.min_loop_count !== undefined && (context.loopCount ?? 0) < condition.min_loop_count) {
      return false;
    }

    // 2. domain
    if (condition.domain && context.domain && !condition.domain.includes(context.domain)) {
      return false;
    }

    // 3. task_type
    if (condition.task_type && context.taskType && !condition.task_type.includes(context.taskType)) {
      return false;
    }

    // 4. loop_stage
    if (condition.loop_stage && context.loopStage && !condition.loop_stage.includes(context.loopStage)) {
      return false;
    }

    // 5. keywords（Goal 描述关键词）
    if (condition.keywords && context.goalKeywords) {
      const hasMatch = condition.keywords.some(kw =>
        context.goalKeywords!.some(gk => gk.toLowerCase().includes(kw.toLowerCase()))
      );
      if (!hasMatch) return false;
    }

    // 6. affected_file_pattern（glob 匹配）
    if (condition.affected_file_pattern && context.affectedFiles) {
      const hasMatch = condition.affected_file_pattern.some(pat =>
        context.affectedFiles!.some(f => this.globMatch(f, pat))
      );
      if (!hasMatch) return false;
    }

    return true;
  }

  /**
   * 简单 glob 匹配：*.test.ts → 正则
   */
  private globMatch(file: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___GLOBSTAR___')
      .replace(/\*/g, '[^/\\]*')
      .replace(/___GLOBSTAR___/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(file);
  }
}
