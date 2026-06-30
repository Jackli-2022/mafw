"use strict";
/**
 * Run Execute Wave Tool — Execute Wave tool 函数
 *
 * 职责：
 *   1. 执行单个 Wave 内的所有 Task
 *   2. 每个 Task 在独立 Git 分支上执行
 *   3. 调用 LLM 编写代码
 *   4. 合并 Wave 结果
 *
 * 被 mafw-execute/entry.ts 调用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTaskPrompt = buildTaskPrompt;
exports.parseTaskResult = parseTaskResult;
/**
 * 构建 Task Prompt
 */
function buildTaskPrompt(task, worktreeDir) {
    return `# Task: ${task.id}\n\n${task.description}\n\n## Affected Files\n\n${(task.affected_files || []).join('\n')}\n\n## Instructions\n\nImplement this task. Write the code to the affected files.\nWorktree: ${worktreeDir}\n`;
}
/**
 * 解析 Task 执行结果
 */
function parseTaskResult(content) {
    // 简化实现：提取代码块
    const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
    return {
        files: [],
        code: codeBlocks.join('\n')
    };
}
//# sourceMappingURL=run-execute-wave.js.map