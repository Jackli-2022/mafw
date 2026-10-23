// 聊天选中文本 → composer blockquote（纯函数，无 DOM）。
//
// 规则：CRLF 归一；去掉首尾空白行（保留内容缩进）；每行前缀 "> "，空行 ">"；
// 超过 maxChars 截断并追加一行可见标记。appendQuote 负责与现有草稿拼接。

export const QUOTE_MAX_CHARS = 4000

export function formatQuote(text: string, opts?: { maxChars?: number }): string {
  if (typeof text !== "string" || !text) return ""
  const maxChars = Math.max(1, opts?.maxChars ?? QUOTE_MAX_CHARS)
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  let body = lines.join("\n")
  if (!body) return ""

  const truncated = body.length > maxChars
  if (truncated) body = body.slice(0, maxChars)

  const out = body.split("\n").map((line) => (line.length > 0 ? `> ${line}` : ">"))
  if (truncated) out.push("> …（引用已截断）")
  return out.join("\n")
}

export function appendQuote(prev: string, block: string): string {
  if (!block) return prev
  if (!prev.trim()) return `${block}\n\n`
  return `${prev.replace(/\s*$/, "")}\n\n${block}\n\n`
}
