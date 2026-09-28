// tool-summary：assistant 消息内已完成的 tool part 聚合为一行摘要（Claude 式
// "Read 3 files" 元数据行）。纯逻辑无 Solid 依赖，便于 bun:test。
export type ToolSummaryLine = { icon: string; text: string; error?: boolean }

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function summarizeTools(parts: any[]): ToolSummaryLine[] {
  const lines: ToolSummaryLine[] = []
  for (const p of parts ?? []) {
    if (p?.type !== "tool") continue
    const status = p.state?.status
    if (status !== "completed" && status !== "error") continue
    const name = cap(String(p.tool ?? "tool"))
    const isErr = status === "error" || !!p.state?.error
    const last = lines[lines.length - 1]
    // 同名连续合并：Read ×3
    if (last && !last.error && !isErr && last.text.replace(/ ×\d+$/, "") === name) {
      const m = last.text.match(/ ×(\d+)$/)
      last.text = `${name} ×${m ? Number(m[1]) + 1 : 2}`
      continue
    }
    lines.push({ icon: isErr ? "✗" : "✓", text: name, error: isErr || undefined })
  }
  return lines
}
