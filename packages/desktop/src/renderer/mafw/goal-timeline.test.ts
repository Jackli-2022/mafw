import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildGoalLanes,
  cellTone,
  formatDuration,
  cellSummary,
  artifactRef,
  errorText,
  isMissingGoalStateError,
  timelineFailure,
  type NodeRun,
} from "./goal-timeline"

const node = (p: Partial<NodeRun>): NodeRun => ({
  runId: 1, loop: 1, node: "plan", attempt: 1, status: "succeeded",
  sessionId: "s1", startedAt: "2026-10-09T00:00:00Z", finishedAt: "2026-10-09T00:00:02Z",
  durationMs: 2000, outcome: "waves=2", error: null, tokensInput: 1, tokensOutput: 1, costUsd: null,
  ...p,
})

describe("cellTone", () => {
  test("succeeded → ok；failed/timeout/aborted → fail；running → running；null → idle", () => {
    expect(cellTone(node({ status: "succeeded" }))).toBe("ok")
    expect(cellTone(node({ status: "failed" }))).toBe("fail")
    expect(cellTone(node({ status: "timeout" }))).toBe("fail")
    expect(cellTone(node({ status: "aborted" }))).toBe("fail")
    expect(cellTone(node({ status: "running", finishedAt: null }))).toBe("running")
    expect(cellTone(null)).toBe("idle")
  })
  test("review succeeded 但 outcome=FAIL/ERROR → fail（verdict 覆盖）", () => {
    expect(cellTone(node({ node: "review", status: "succeeded", outcome: "FAIL" }))).toBe("fail")
    expect(cellTone(node({ node: "review", status: "succeeded", outcome: "ERROR" }))).toBe("fail")
    expect(cellTone(node({ node: "review", status: "succeeded", outcome: "PASS" }))).toBe("ok")
  })
})

describe("formatDuration", () => {
  test("null/负/非数 → '—'", () => {
    expect(formatDuration(null)).toBe("—")
    expect(formatDuration(-5)).toBe("—")
    expect(formatDuration(NaN)).toBe("—")
  })
  test("45s / 3m12s / 1h04m", () => {
    expect(formatDuration(45_000)).toBe("45s")
    expect(formatDuration(192_000)).toBe("3m12s")
    expect(formatDuration(3_840_000)).toBe("1h04m")
  })
})

describe("cellSummary", () => {
  test("review → outcome；execute → outcome + $cost；plan → outcome", () => {
    expect(cellSummary(node({ node: "review", status: "succeeded", outcome: "PASS" }))).toBe("PASS")
    expect(cellSummary(node({ node: "execute", status: "succeeded", outcome: "receipts=2", costUsd: 0.41 }))).toBe("receipts=2 · $0.41")
    expect(cellSummary(node({ node: "plan", status: "succeeded", outcome: "waves=3" }))).toBe("waves=3")
  })
  test("running → '已用 X'（注入 now 保证确定性）", () => {
    const now = Date.parse("2026-10-09T00:10:00Z")
    const r = node({ status: "running", finishedAt: null, startedAt: "2026-10-09T00:04:00Z" })
    expect(cellSummary(r, now)).toBe("已用 6m")
  })
  test("null → ''", () => { expect(cellSummary(null)).toBe("") })
})

describe("buildGoalLanes", () => {
  test("列数 = max(maxRounds, 出现的最大 loop)；缺失格 idle", () => {
    const { loops, lanes } = buildGoalLanes([node({ loop: 1 }), node({ loop: 2, node: "execute" })], 3)
    expect(loops).toEqual([1, 2, 3])
    expect(lanes.map(l => l.node)).toEqual(["plan", "execute", "review"])
    const planL3 = lanes[0].cells[2]
    expect(planL3.latest).toBeNull()
    expect(planL3.tone).toBe("idle")
  })
  test("(loop,node) 多 attempt 归同格：latest=最大 attempt，attempts 升序", () => {
    const runs = [
      node({ runId: 1, loop: 1, node: "execute", attempt: 1, status: "timeout" }),
      node({ runId: 2, loop: 1, node: "execute", attempt: 2, status: "succeeded" }),
    ]
    const { lanes } = buildGoalLanes(runs, 1)
    const cell = lanes.find(l => l.node === "execute")!.cells[0]
    expect(cell.attempts.map(a => a.attempt)).toEqual([1, 2])
    expect(cell.latest!.attempt).toBe(2)
    expect(cell.tone).toBe("ok")
  })
})

describe("artifactRef", () => {
  test("per-loop 引用（相对路径）", () => {
    expect(artifactRef("plan", "g1", 1)!.ref).toBe("waves.json")
    expect(artifactRef("execute", "g1", 2)!.ref).toBe("receipts/g1/loop-2-receipt.json")
    expect(artifactRef("review", "g1", 2)!.ref).toBe("reviews/g1-loop2.md")
    expect(artifactRef("askUser", "g1", 1)).toBeNull()
  })
})

// ── discussing Goal 没有 GoalState：timeline 只是不可用，不是页面错误 ──────────
describe("isMissingGoalStateError", () => {
  test("SDK/网关的 missing-state 404 → true（含 Electron IPC 前缀包裹）", () => {
    expect(isMissingGoalStateError(new Error("HTTP 404: goal state not found"))).toBe(true)
    expect(isMissingGoalStateError("HTTP 404: goal state not found")).toBe(true)
    expect(isMissingGoalStateError(
      new Error("Error invoking remote method 'mafw-invoke': Error: HTTP 404: goal state not found"),
    )).toBe(true)
    expect(isMissingGoalStateError({ status: 404, message: "goal state not found" })).toBe(true)
    expect(isMissingGoalStateError({ statusCode: 404, message: "goal state not found" })).toBe(true)
  })

  test("非 missing-state 的 404 / 其它错误 → false（保持页面错误）", () => {
    expect(isMissingGoalStateError(new Error("HTTP 404: goal not found"))).toBe(false)
    expect(isMissingGoalStateError(new Error("HTTP 404: Not Found"))).toBe(false)
    expect(isMissingGoalStateError(new Error("HTTP 500: goal state not found"))).toBe(false)
    expect(isMissingGoalStateError({ status: 409, message: "goal state not found" })).toBe(false)
    // 无 404 证据时绝不猜（可能是解析/网络错误恰好带同样文案）
    expect(isMissingGoalStateError(new Error("goal state not found"))).toBe(false)
    expect(isMissingGoalStateError(new Error("Failed to fetch"))).toBe(false)
    expect(isMissingGoalStateError(undefined)).toBe(false)
    expect(isMissingGoalStateError(null)).toBe(false)
  })
})

describe("timelineFailure", () => {
  test("missing-state 404 → unavailable 且无页面错误", () => {
    expect(timelineFailure(new Error("HTTP 404: goal state not found")))
      .toEqual({ unavailable: true, error: null })
  })

  test("其它错误 → 保留错误文案（页面错误）", () => {
    expect(timelineFailure(new Error("HTTP 500: boom")))
      .toEqual({ unavailable: false, error: "HTTP 500: boom" })
    expect(timelineFailure(new Error("HTTP 404: goal not found")))
      .toEqual({ unavailable: false, error: "HTTP 404: goal not found" })
    expect(timelineFailure({ status: 503, message: "gateway down" }).error).toBe("gateway down")
  })

  test("errorText：message 优先，空值给兜底文案", () => {
    expect(errorText(new Error("boom"))).toBe("boom")
    expect(errorText("boom")).toBe("boom")
    expect(errorText({ message: "" })).toBe("[object Object]")
    expect(errorText(undefined)).toBe("未知错误")
    expect(errorText(null)).toBe("未知错误")
    expect(errorText("")).toBe("未知错误")
  })
})

describe("GoalDetailOverlay timeline 加载接线", () => {
  const src = readFileSync(join(import.meta.dirname, "components/GoalDetailOverlay.tsx"), "utf8")
  const loadBody = src.slice(src.indexOf("async function load("), src.indexOf("// 显式 podId"))

  test("load 只把 missing-state 404 当 timeline 不可用", () => {
    expect(loadBody).toContain("timelineFailure(")
    expect(loadBody).toMatch(/timelineFailure\(e\)/)
    expect(loadBody).toMatch(/if \(failure\.unavailable\) \{[\s\S]*?setTimeline\(null\)/)
    expect(loadBody).toContain("setError(failure.error)")
  })

  test("协作面板（阶段/版本/方向/探针）仍在渲染树内", () => {
    expect(src).toContain("<PodDirectionPanel")
    expect(src).toContain("<PodProbePanel")
    expect(src).toContain("revisionRows()")
    expect(src).toContain("stageText()")
  })
})
