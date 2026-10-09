// packages/desktop/src/renderer/mafw/goal-timeline.ts
// Goal 执行状态纯逻辑：泳道装配 / 状态映射 / 时长与摘要格式。
// 数据形状 = P1 timeline API node（GET /api/goals/:id/timeline → nodes[]）。

export interface NodeRun {
  runId: number
  loop: number
  node: string
  attempt: number
  status: string // running|succeeded|failed|timeout|aborted
  sessionId: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  outcome: string | null
  error: string | null
  tokensInput: number | null
  tokensOutput: number | null
  costUsd: number | null
}

export type CellTone = "ok" | "running" | "fail" | "idle"

export interface LaneCell {
  node: string
  loop: number
  latest: NodeRun | null
  attempts: NodeRun[]
  tone: CellTone
}

export interface Lane { node: string; cells: LaneCell[] }

export const PHASES = ["plan", "execute", "review"] as const

export function cellTone(run: NodeRun | null): CellTone {
  if (!run) return "idle"
  if (run.status === "running") return "running"
  if (run.status === "succeeded") {
    // review 的 verdict 在 outcome（PASS/FAIL/ERROR）——FAIL/ERROR 覆盖为 fail
    if (run.node === "review" && run.outcome && run.outcome !== "PASS") return "fail"
    return "ok"
  }
  return "fail" // failed | timeout | aborted
}

export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return rs ? `${m}m${String(rs).padStart(2, "0")}s` : `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${String(rm).padStart(2, "0")}m`
}

export function cellSummary(run: NodeRun | null, now: number = Date.now()): string {
  if (!run) return ""
  if (run.status === "running") {
    const ms = run.startedAt ? now - Date.parse(run.startedAt) : null
    return `已用 ${formatDuration(ms)}`
  }
  if (run.node === "review") return run.outcome ?? (run.error ? "见明细" : "")
  if (run.node === "execute") {
    const cost = run.costUsd != null ? ` · $${run.costUsd.toFixed(2)}` : ""
    return `${run.outcome ?? ""}${cost}`.trim()
  }
  return run.outcome ?? ""
}

export function buildGoalLanes(nodes: NodeRun[], maxRounds: number): { loops: number[]; lanes: Lane[] } {
  const maxSeen = nodes.reduce((m, n) => Math.max(m, n.loop), 0)
  const maxLoop = Math.max(maxRounds || 0, maxSeen, 1)
  const loops = Array.from({ length: maxLoop }, (_, i) => i + 1)
  const lanes: Lane[] = PHASES.map((node) => ({
    node,
    cells: loops.map((loop) => {
      const attempts = nodes
        .filter((n) => n.node === node && n.loop === loop)
        .sort((a, b) => a.attempt - b.attempt)
      const latest = attempts.length ? attempts[attempts.length - 1] : null
      return { node, loop, latest, attempts, tone: cellTone(latest) }
    }),
  }))
  return { loops, lanes }
}

/** 产物引用（相对路径，按 P1 命名约定推导；桌面无 mafwDir，故为相对引用）。 */
export function artifactRef(node: string, goalId: string, loop: number): { label: string; ref: string } | null {
  if (node === "plan") return { label: "waves.json", ref: "waves.json" }
  if (node === "execute") return { label: `loop-${loop}-receipt.json`, ref: `receipts/${goalId}/loop-${loop}-receipt.json` }
  if (node === "review") return { label: `${goalId}-loop${loop}.md`, ref: `reviews/${goalId}-loop${loop}.md` }
  return null
}
