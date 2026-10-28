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
    const tasks = Array.isArray(w.tasks) ? w.tasks.filter((t) => typeof t === "string" && t.trim()) : []
    if (tasks.length > 0) lines.push(...tasks.map((t) => `- ${t}`), "")
    const risk = typeof w.riskNote === "string" ? w.riskNote.trim() : ""
    if (risk) lines.push(`> ${risk}`, "")
  }
  return lines.join("\n").trimEnd()
}
