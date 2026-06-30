"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanPrompt = buildPlanPrompt;
exports.parsePlanResponse = parsePlanResponse;
exports.formatTaskMarkdown = formatTaskMarkdown;
/**
 * 拼接 Plan Prompt
 */
function buildPlanPrompt(context) {
    const { goal, lessons, deltas, handoff, loopNum } = context;
    let prompt = `# Plan Agent — Loop ${loopNum}\n\n`;
    prompt += `## Goal Charter\n\n${goal}\n\n`;
    if (handoff) {
        prompt += `## Handoff from Loop ${loopNum - 1}\n\n${handoff.summary}\n\n`;
    }
    if (lessons.length > 0) {
        prompt += `## Lessons Learned (L2)\n\n`;
        for (const lesson of lessons) {
            prompt += `- ${lesson}\n`;
        }
        prompt += '\n';
    }
    if (deltas.length > 0) {
        prompt += `## Parametric Constraints (L3)\n\n`;
        for (const delta of deltas) {
            if (delta.type === 'constraint') {
                prompt += `- constraint: ${delta.rule}\n`;
            }
            else if (delta.type === 'prompt') {
                prompt += `- prompt: ${delta.prompt_delta}\n`;
            }
            else if (delta.type === 'pattern') {
                prompt += `- pattern: ${delta.pattern_template}\n`;
            }
        }
        prompt += '\n';
    }
    prompt += `## Instructions\n\n`;
    prompt += `Generate a detailed execution plan with waves and tasks.\n`;
    prompt += `Output format: JSON with "waves" and "tasks" arrays.\n`;
    prompt += `Each task must have: id, description, affected_files, acceptance_criteria.\n`;
    return prompt;
}
/**
 * 解析 LLM 回复为 Plan
 */
function parsePlanResponse(content) {
    try {
        // 尝试直接解析 JSON
        return JSON.parse(content);
    }
    catch {
        // 尝试从 markdown 代码块中提取
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1].trim());
        }
        // fallback: 返回空结构
        console.warn('[run-plan] Failed to parse LLM response, using fallback');
        return { waves: [], tasks: [] };
    }
}
/**
 * 格式化 Task 为 Markdown
 */
function formatTaskMarkdown(task) {
    return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).map((f) => `- ${f}`).join('\n')}\n\n## Acceptance Criteria\n\n${(task.acceptance_criteria || []).map((c) => `- [ ] ${c}`).join('\n')}\n`;
}
//# sourceMappingURL=run-plan.js.map