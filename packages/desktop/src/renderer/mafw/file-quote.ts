// packages/desktop/src/renderer/mafw/file-quote.ts
// B2（W5b）：文件预览选区 → composer 引文块。纯函数。
// 格式与批注引文锚一致（blockquote + 来源），但无「我的意见」——引用是
// 「把这段放进输入框」的轻动作，用户可再补自己的话。
const QUOTE_CAP = 2000

export function buildFileQuote(
  rel: string,
  quote: string,
  opts?: { startLine?: number; endLine?: number; max?: number },
): string {
  const raw = (quote ?? "").trim()
  if (!raw) return ""
  const cap = opts?.max ?? QUOTE_CAP
  const truncated = raw.length > cap
  const text = truncated ? raw.slice(0, cap) : raw
  const lines = text.split(/\r?\n/).map((l) => `> ${l}`)
  if (truncated) lines.push("> …（截断）")
  const range =
    typeof opts?.startLine === "number" && typeof opts?.endLine === "number"
      ? opts.startLine === opts.endLine
        ? `第 ${opts.startLine} 行`
        : `第 ${opts.startLine}-${opts.endLine} 行`
      : null
  const source = `引用自 \`${rel || "(未命名)"}\`${range ? `（${range}）` : ""}`
  return [...lines, "", source].join("\n")
}
