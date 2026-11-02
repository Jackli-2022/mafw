// packages/desktop/src/renderer/mafw/components/plan-render.ts
// W1 计划审阅：waves.json → Markdown 确定性渲染（无 LLM；非法输入空串）。
// Task 20：计划审阅升级为 PlanPackage（waves + Goal Eval + Spike 证据 + 版本哈希）。
export interface PlanWave {
  id: string
  title: string
  tasks: string[] | Array<{ title?: string; acceptance?: string[] }>
  riskNote?: string
}

export interface PlanDoc {
  status?: string
  taskType?: string
  waves?: PlanWave[]
  ambiguities?: string[]
}

export interface PlanCondition {
  id: string
  statement: string
  required: boolean
  evidence: string
  method: string
}

export interface PlanConditionMapping {
  tasks?: string[]
  probes?: string[]
  artifacts?: string[]
}

export interface PlanGoalEval {
  outcome: string
  conditions: PlanCondition[]
  failureConditions?: string[]
  constraints?: string[]
  nonGoals?: string[]
  mapping?: Record<string, PlanConditionMapping>
}

export interface PlanProbeReport {
  conclusion?: string | null
  commands?: string[]
  keyOutput?: string | null
  repro?: string[]
  remainingAssumptions?: string[]
  impact?: { plan?: string | null; goalEval?: string | null }
}

export interface PlanProbe {
  id: string
  status?: string | null
  conclusion?: string | null
  request?: { question?: string | null; hypothesis?: string | null }
  report?: PlanProbeReport | null
}

/** `GET /api/goals/:id/plan` 响应（Task 13）+ 当前 revision 的 probes（Task 18）。 */
export interface PlanPackageDoc {
  waves?: unknown
  goalEval?: unknown
  probes?: unknown
  planHash?: string | null
  evalHash?: string | null
  revision?: number | null
  stale?: boolean
  planFeedback?: string | null
  approvalMode?: string | null
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

// ── waves（旧 renderPlanMarkdown 的行为必须逐字保留：既有测试与用户预期） ──────

function wavesSection(input: unknown, heading: string): string {
  if (!input || typeof input !== "object") return ""
  const doc = input as PlanDoc
  if (doc.status === "need_clarification") {
    const qs = Array.isArray(doc.ambiguities) ? doc.ambiguities.filter((q) => typeof q === "string" && q.trim()) : []
    if (qs.length === 0) return ""
    return ["# 计划（待澄清）", "", "规划者提出以下问题，需要先解答：", "", ...qs.map((q) => `- ${q}`)].join("\n")
  }
  const waves = Array.isArray(doc.waves) ? doc.waves.filter((w) => w && typeof w === "object") : []
  if (waves.length === 0) return ""
  const lines: string[] = [heading, ""]
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

export function renderPlanMarkdown(input: unknown): string {
  return wavesSection(input, "# 执行计划")
}

// ── Goal Eval（Task 20） ────────────────────────────────────────────────────

function normalizeConditions(raw: unknown): PlanCondition[] {
  if (!Array.isArray(raw)) return []
  const out: PlanCondition[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const id = clean((item as any).id)
    const statement = clean((item as any).statement)
    if (!id || !statement) continue
    out.push({
      id,
      statement,
      required: (item as any).required === true,
      evidence: clean((item as any).evidence),
      method: clean((item as any).method),
    })
  }
  return out
}

function goalEvalSection(raw: unknown): string[] {
  const lines: string[] = ["## Goal Eval", ""]
  if (!raw || typeof raw !== "object") {
    lines.push("（本计划没有可解析的 Goal Eval；批准前需 Tech Lead 补齐。）", "")
    return lines
  }
  const evalDoc = raw as PlanGoalEval
  const outcome = clean(evalDoc.outcome)
  const conditions = normalizeConditions(evalDoc.conditions)
  if (!outcome || conditions.length === 0) {
    lines.push("（本计划没有可解析的 Goal Eval；批准前需 Tech Lead 补齐。）", "")
    return lines
  }
  lines.push(`目标：${outcome}`, "")
  const required = conditions.filter((c) => c.required)
  const optional = conditions.filter((c) => !c.required)
  const renderCondition = (c: PlanCondition, tag: string) => {
    lines.push(`- ${c.id}: ${c.statement}（${tag}）`)
    if (c.evidence) lines.push(`  - 证据：${c.evidence}`)
    if (c.method) lines.push(`  - 验证：${c.method}`)
  }
  if (required.length > 0) {
    lines.push("必需条件：", "")
    for (const c of required) renderCondition(c, "必需")
    lines.push("")
  }
  if (optional.length > 0) {
    lines.push("可选条件：", "")
    for (const c of optional) renderCondition(c, "可选")
    lines.push("")
  }
  const failure = stringList(evalDoc.failureConditions)
  if (failure.length > 0) lines.push("失败条件：", "", ...failure.map((f) => `- ${f}`), "")
  const constraints = stringList(evalDoc.constraints)
  if (constraints.length > 0) lines.push("约束：", "", ...constraints.map((c) => `- ${c}`), "")
  const nonGoals = stringList(evalDoc.nonGoals)
  if (nonGoals.length > 0) lines.push("非目标：", "", ...nonGoals.map((n) => `- ${n}`), "")

  const mapping = evalDoc.mapping && typeof evalDoc.mapping === "object" ? evalDoc.mapping : {}
  const mappingRows: string[] = []
  for (const c of conditions) {
    const entry = mapping[c.id]
    if (!entry || typeof entry !== "object") continue
    const parts: string[] = []
    const tasks = stringList(entry.tasks)
    const probes = stringList(entry.probes)
    const artifacts = stringList(entry.artifacts)
    if (tasks.length > 0) parts.push(`tasks: ${tasks.join(", ")}`)
    if (probes.length > 0) parts.push(`probes: ${probes.join(", ")}`)
    if (artifacts.length > 0) parts.push(`artifacts: ${artifacts.join(", ")}`)
    if (parts.length > 0) mappingRows.push(`- ${c.id} → ${parts.join(" · ")}`)
  }
  if (mappingRows.length > 0) lines.push("证据映射：", "", ...mappingRows, "")
  return lines
}

// ── Spike / Probe 证据（Task 18 DTO 的子集；畸形条目跳过） ────────────────────

function normalizeProbes(raw: unknown): PlanProbe[] {
  if (!Array.isArray(raw)) return []
  const out: PlanProbe[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const id = clean((item as any).id)
    if (!id) continue
    out.push(item as PlanProbe)
  }
  return out
}

function probeSection(raw: unknown): { lines: string[]; assumptions: string[] } {
  const probes = normalizeProbes(raw)
  if (probes.length === 0) return { lines: [], assumptions: [] }
  const lines: string[] = ["## Probe 证据", ""]
  const assumptions: string[] = []
  const seen = new Set<string>()
  for (const probe of probes) {
    const report = probe.report && typeof probe.report === "object" ? probe.report : null
    const conclusion = clean(probe.conclusion) || clean(report?.conclusion) || clean(probe.status) || "pending"
    const question = clean(probe.request?.question)
    lines.push(`- Probe ${probe.id} · ${conclusion}${question ? ` — ${question}` : ""}`)
    const hypothesis = clean(probe.request?.hypothesis)
    if (hypothesis) lines.push(`  - 假设：${hypothesis}`)
    const keyOutput = clean(report?.keyOutput)
    if (keyOutput) lines.push(`  - 关键输出：${keyOutput}`)
    const commands = stringList(report?.commands)
    if (commands.length > 0) lines.push(`  - 命令：${commands.join(" · ")}`)
    const repro = stringList(report?.repro)
    if (repro.length > 0) lines.push(`  - 复现：${repro.join("；")}`)
    const impact = report?.impact
    if (impact && (clean(impact.plan) || clean(impact.goalEval))) {
      const bits: string[] = []
      if (clean(impact.plan)) bits.push(`Plan：${clean(impact.plan)}`)
      if (clean(impact.goalEval)) bits.push(`Goal Eval：${clean(impact.goalEval)}`)
      lines.push(`  - 影响：${bits.join(" · ")}`)
    }
    for (const item of stringList(report?.remainingAssumptions)) {
      if (seen.has(item)) continue
      seen.add(item)
      assumptions.push(item)
    }
    lines.push("")
  }
  return { lines, assumptions }
}

// ── PlanPackage（Task 20） ─────────────────────────────────────────────────

/**
 * 计划审阅的权威渲染：Plan（waves）+ Goal Eval + Spike 证据 + 版本绑定。
 * 输入为 `GET /api/goals/:id/plan` 响应（可额外带 `probes`）。
 * 非法/空输入 → ''（调用方据此显示空态）。
 */
export function renderPlanPackage(input: unknown): string {
  if (!input || typeof input !== "object") return ""
  const pkg = input as PlanPackageDoc
  const waves = wavesSection(pkg.waves, "## 执行计划")
  const hasEval = !!pkg.goalEval && typeof pkg.goalEval === "object"
  const evalLines = waves || hasEval ? goalEvalSection(pkg.goalEval).join("\n") : ""
  const probe = probeSection(pkg.probes)
  if (!waves && !evalLines.trim() && probe.lines.length === 0) return ""

  const revision = typeof pkg.revision === "number" && pkg.revision > 0 ? pkg.revision : null
  const planHash = clean(pkg.planHash)
  const evalHash = clean(pkg.evalHash)
  const header: string[] = ["# Plan Package"]
  const meta: string[] = []
  if (revision !== null) meta.push(`Revision ${revision}`)
  if (planHash) meta.push(`Plan hash: ${planHash}`)
  if (evalHash) meta.push(`Eval hash: ${evalHash}`)
  if (meta.length > 0) header.push("", meta.join(" · "))
  if (pkg.stale) header.push("", "> ⚠ 计划内容已变更：旧批准已失效，请重新审阅后再批准。")
  const feedback = clean(pkg.planFeedback)
  if (feedback) header.push("", `> 上一轮反馈：${feedback}`)
  header.push("")

  const parts = [header.join("\n").trimEnd()]
  if (waves) parts.push(waves)
  parts.push(evalLines.trimEnd())
  if (probe.lines.length > 0) {
    parts.push(probe.lines.join("\n").trimEnd())
    if (probe.assumptions.length > 0) {
      parts.push(["## 未验证假设", "", ...probe.assumptions.map((a) => `- ${a}`)].join("\n"))
    }
  }
  return parts.filter(Boolean).join("\n\n").trimEnd()
}
