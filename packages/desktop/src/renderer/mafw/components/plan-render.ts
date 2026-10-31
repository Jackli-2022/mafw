// packages/desktop/src/renderer/mafw/components/plan-render.ts
// W1 计划审阅：waves.json → Markdown 确定性渲染（无 LLM；非法输入空串）。
export interface PlanWave {
  id: string
  title: string
  tasks: string[]
  riskNote?: string
}

export interface PlanDoc {
  status?: string
  taskType?: string
  waves?: PlanWave[]
  ambiguities?: string[]
}

export function renderPlanMarkdown(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const doc = input as PlanDoc
  if (doc.status === "need_clarification") {
    const qs = Array.isArray(doc.ambiguities) ? doc.ambiguities.filter((q) => typeof q === "string" && q.trim()) : []
    if (qs.length === 0) return ""
    return ["# 计划（待澄清）", "", "规划者提出以下问题，需要先解答：", "", ...qs.map((q) => `- ${q}`)].join("\n")
  }
  const waves = Array.isArray(doc.waves) ? doc.waves.filter((w) => w && typeof w === "object") : []
  if (waves.length === 0) return ""
  const lines: string[] = ["# 执行计划", ""]
  if (typeof doc.taskType === "string" && doc.taskType) lines.push(`任务类型：${doc.taskType}`, "")
  for (const w of waves) {
    lines.push(`## Wave ${w.id ?? "?"}：${w.title ?? ""}`, "")
    const rawTasks = Array.isArray(w.tasks) ? w.tasks : []
    const rows: string[] = []
    for (const raw of rawTasks) {
      // 兼容两种形态：字符串任务 / { title, acceptance[] }
      if (typeof raw === "string") {
        if (raw.trim()) rows.push(`- ${raw.trim()}`)
        continue
      }
      if (!raw || typeof raw !== "object") continue
      const title = typeof (raw as any).title === "string" ? (raw as any).title.trim() : ""
      if (!title) continue
      const acceptance = Array.isArray((raw as any).acceptance)
        ? (raw as any).acceptance.filter((item: unknown) => typeof item === "string" && item.trim())
        : []
      rows.push(`- ${title}`)
      if (acceptance.length > 0) rows.push(...acceptance.map((item: string) => `  - 验收：${item.trim()}`))
    }
    if (rows.length > 0) lines.push(...rows, "")
    const risk = typeof w.riskNote === "string" ? w.riskNote.trim() : ""
    if (risk) lines.push(`> ${risk}`, "")
  }
  return lines.join("\n").trimEnd()
}
