"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReviewPrompt = buildReviewPrompt;
exports.parseReviewResponse = parseReviewResponse;
exports.formatReview = formatReview;
exports.formatLesson = formatLesson;
/**
 * 拼接 Review Prompt
 */
function buildReviewPrompt(context) {
    const { receipts, diff, metrics, boundaries, remoteResults, goal } = context;
    let prompt = `# Review Agent\n\n`;
    prompt += `## Goal Charter\n\n${goal}\n\n`;
    prompt += `## Execution Receipts\n\n`;
    for (const r of receipts) {
        prompt += `### Wave ${r.waveId || 'unknown'}\n\n`;
        prompt += `Status: ${r.status}\n`;
        if (r.tasks) {
            for (const t of r.tasks) {
                prompt += `- Task ${t.taskId}: ${t.status}\n`;
            }
        }
        prompt += '\n';
    }
    prompt += `## Code Changes\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n`;
    prompt += `## Metrics\n\n`;
    for (const [key, value] of Object.entries(metrics)) {
        prompt += `- ${key}: target ${value.target}${value.unit}\n`;
    }
    prompt += '\n';
    prompt += `## Boundaries\n\n`;
    for (const b of boundaries) {
        prompt += `- ${b}\n`;
    }
    prompt += '\n';
    if (remoteResults) {
        prompt += `## Remote Test Results\n\n`;
        prompt += `Success: ${remoteResults.success}\n`;
        prompt += `Output: ${remoteResults.output}\n\n`;
    }
    prompt += `## Instructions\n\n`;
    prompt += `Review the execution results against the goal charter, metrics, and boundaries.\n`;
    prompt += `Return a JSON with:\n`;
    prompt += `- verdict: "PASS" or "FAIL"\n`;
    prompt += `- reason: explanation\n`;
    prompt += `- metrics: actual metric values\n`;
    return prompt;
}
/**
 * 解析 Review 结果
 */
function parseReviewResponse(content) {
    try {
        const data = JSON.parse(content);
        return {
            verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
            reason: data.reason || 'No reason provided',
            metrics: data.metrics || {}
        };
    }
    catch {
        // Fallback: 解析文本
        const pass = content.toLowerCase().includes('pass') || content.toLowerCase().includes('通过');
        return {
            verdict: pass ? 'PASS' : 'FAIL',
            reason: content.slice(0, 200),
            metrics: {}
        };
    }
}
/**
 * 格式化 Review 报告
 */
function formatReview(review) {
    return `# Review Report\n\n## Verdict: ${review.verdict}\n\n## Reason\n\n${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
}
/**
 * 格式化 Lesson
 */
function formatLesson(review) {
    return `# Lesson Learned\n\n## Trigger\n\nReview failed: ${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Recommendation\n\n${review.reason}\n`;
}
//# sourceMappingURL=run-review.js.map