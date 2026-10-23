// 标注直发（spec §5.2，Builder Check Q1=A）：选区 → 行范围 + 结构化 prompt → 当前会话。
// prompt 格式与 buildDiffCommentPrompt 同风格（文件引用 + 代码块 + 用户批注 + 行动指令）。

/** 字符偏移 → 1-based 行范围（含端点，to 为 exclusive 边界，越界 clamp）；零宽 → null。
 *  to 恰在下一行行首（exclusive 边界落在换行符后）不多报下一行（终审 Important 9）。 */
export function lineRangeOf(doc: string, from: number, to: number): { startLine: number; endLine: number } | null {
  if (from === to) return null
  const lo = Math.max(0, Math.min(Math.min(from, to), doc.length))
  const hi = Math.max(0, Math.min(Math.max(from, to), doc.length))
  const lineAt = (pos: number) => {
    let line = 1
    for (let i = 0; i < pos; i++) if (doc[i] === "\n") line++
    return line
  }
  const endPos = hi > lo && doc[hi - 1] === "\n" ? hi - 1 : hi
  return { startLine: lineAt(lo), endLine: lineAt(endPos) }
}

/** 选区来源文件必须等于当前活动文件，否则不允许发批注（防串文件/串行号）。 */
export function annotationApplies(activeRel: string | null, selRel: string | null): boolean {
  return !!activeRel && !!selRel && activeRel === selRel
}

import type { Annotation } from "../../shared/annotation-types"

export function buildAnnotationPrompt(
  rel: string,
  startLine: number,
  endLine: number,
  code: string,
  comment: string,
): string {
  const range = startLine === endLine ? `第 ${startLine} 行` : `第 ${startLine}-${endLine} 行`
  return [
    `文件 \`${rel}\` ${range}：`,
    "",
    "```",
    code,
    "```",
    "",
    `我的批注：${comment}`,
    "",
    "请结合批注查看这段代码并回应。",
  ].join("\n")
}

function annotationBlock(item: Annotation, index: number): string {
  const range = item.startLine === item.endLine ? `第 ${item.startLine} 行` : `第 ${item.startLine}-${item.endLine} 行`
  return [
    `【批注 ${index + 1}】`,
    `文件 \`${item.rel}\` ${range}：`,
    "",
    "```",
    item.code,
    "```",
    "",
    `我的批注：${item.comment}`,
  ].join("\n")
}

/** 多条批注打包为一条消息块（草稿批量提交）。 */
export function buildAnnotationBatch(items: Annotation[]): string {
  if (items.length === 0) return ""
  return [
    `以下是 ${items.length} 条代码批注：`,
    "",
    items.map(annotationBlock).join("\n\n"),
    "",
    "请逐条结合批注查看这段代码并回应。",
  ].join("\n")
}
