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
  metrics: Record<string, { target: number; unit: string }>;
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
export function buildReviewPrompt(context: ReviewContext): string {
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
  prompt += `- score: 0-100 (optional, overall quality score)\n`;
  prompt += `- reason: explanation\n`;
  prompt += `- metrics: actual metric values\n`;

  return prompt;
}

/**
 * 解析 Review 结果
 */
export function parseReviewResponse(content: string): ReviewResult {
  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      score: typeof data.score === 'number' ? Math.max(0, Math.min(100, data.score)) : undefined,
      reason: data.reason || 'No reason provided',
      metrics: data.metrics || {}
    };
  } catch {
    // Fallback: 解析文本
    const pass = content.toLowerCase().includes('pass') || content.toLowerCase().includes('通过');
    const scoreMatch = content.match(/score[:\s]+(\d+)/i);
    return {
      verdict: pass ? 'PASS' : 'FAIL',
      score: scoreMatch ? Math.max(0, Math.min(100, parseInt(scoreMatch[1], 10))) : undefined,
      reason: content.slice(0, 200),
      metrics: {}
    };
  }
}

/**
 * 格式化 Review 报告
 */
export function formatReview(review: ReviewResult): string {
  return `# Review Report\n\n## Verdict: ${review.verdict}\n\n## Reason\n\n${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
}

/**
 * 格式化 Lesson
 */
export function formatLesson(review: ReviewResult): string {
  return `# Lesson Learned\n\n## Trigger\n\nReview failed: ${review.reason}\n\n## Metrics\n\n${Object.entries(review.metrics).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Recommendation\n\n${review.reason}\n`;
}
