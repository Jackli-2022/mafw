export interface InlineEditRequest {
  rel: string
  startLine: number
  endLine: number
  code: string
  instruction: string
}

export interface InlineEditSubmission extends InlineEditRequest {
  root?: string
  scopeKey?: string
}

/**
 * Inline edit is an explicit file-edit turn: the selected ranges travel with
 * the instruction, but the agent owns the actual edit/tools. Desktop never
 * applies a model-authored replacement directly.
 */
export function buildInlineEditPrompt(req: InlineEditRequest): string {
  return `请直接修改文件（不要只给建议）：
文件：${req.rel}
行：L${req.startLine}${req.endLine !== req.startLine ? `–L${req.endLine}` : ""}
选中代码：
\`\`\`
${req.code}
\`\`\`
修改要求：${req.instruction}

约束：
- 只修改该选区及必要的最小上下文，保持现有代码风格与行为边界（除非要求明确改变行为）。
- 如果无法安全修改，说明原因，不要猜测。
- 不要执行破坏性命令，不要提交 git。完成后用几句话总结改动。`
}
