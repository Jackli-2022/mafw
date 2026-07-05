/**
 * Run Review Tool — Review tool 函数
 *
 * 职责：
 *   1. 拼接 Review Prompt
 *   2. 调用 LLM 审查
 *   3. 解析 Review 结果
 *
 * 被 mafw-review/entry.ts 调用。
 */
export interface ReviewContext {
    receipts: any[];
    diff: string;
    metrics: Record<string, {
        target: number;
        unit: string;
    }>;
    boundaries: string[];
    remoteResults: any | null;
    goal: string;
}
export interface ReviewResult {
    verdict: 'PASS' | 'FAIL';
    score?: number;
    reason: string;
    metrics: Record<string, number>;
}
/**
 * 拼接 Review Prompt
 */
export declare function buildReviewPrompt(context: ReviewContext): string;
/**
 * 解析 Review 结果
 */
export declare function parseReviewResponse(content: string): ReviewResult;
/**
 * 格式化 Review 报告
 */
export declare function formatReview(review: ReviewResult): string;
/**
 * 格式化 Lesson
 */
export declare function formatLesson(review: ReviewResult): string;
//# sourceMappingURL=run-review.d.ts.map