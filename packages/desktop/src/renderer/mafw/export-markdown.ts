// Session → Markdown export (the shareable artifact for a local-first app
// with no hosted share service). Pure builder; the main process owns the
// save dialog + file write.
export type ExportTurn = { role: string; text: string; time?: number }

export function buildSessionMarkdown(input: { title: string; turns: ExportTurn[] }): string {
  const title = input.title?.trim() || "MAFW 会话"
  const lines: string[] = [`# ${title}`, ""]
  if (input.turns.length === 0) {
    lines.push("（空）")
    return lines.join("\n")
  }
  const fmtTime = (t?: number) => {
    if (!t) return ""
    const d = new Date(t)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  for (const t of input.turns) {
    if (!t.text || !t.text.trim()) continue
    const who = t.role === "user" ? "你" : "Assistant"
    const when = fmtTime(t.time)
    lines.push(`## ${who}${when ? ` · ${when}` : ""}`, "", t.text.trim(), "")
  }
  return lines.join("\n")
}
