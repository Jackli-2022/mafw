/**
 * Run Plan Tool — Prompt 拼接 + LLM 调用
 *
 * 职责：
 *   1. 读取 Goal Charter、Lessons、Parametric Deltas
 *   2. 拼接完整 Plan Prompt
 *   3. 调用 LLM
 *   4. 解析回复为结构化 Plan
 *
 * 被 mafw-plan/entry.ts 调用。
 */
import { Delta } from '../types/parametric';
export interface PlanContext {
    goal: string;
    lessons: string[];
    deltas: Delta[];
    handoff: any | null;
    loopNum: number;
}
export interface PlanResult {
    waves: any[];
    tasks: any[];
}
/**
 * 拼接 Plan Prompt
 */
export declare function buildPlanPrompt(context: PlanContext): string;
/**
 * 解析 LLM 回复为 Plan
 */
export declare function parsePlanResponse(content: string): PlanResult;
/**
 * 格式化 Task 为 Markdown
 */
export declare function formatTaskMarkdown(task: any): string;
//# sourceMappingURL=run-plan.d.ts.map