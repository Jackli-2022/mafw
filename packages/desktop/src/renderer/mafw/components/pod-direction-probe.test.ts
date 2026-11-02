// Task 20：方向裁定面板 + Spike 报告卡的纯逻辑（文案/状态判定）。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { directionAction, directionSummary, directionDecisionLabel } from "./PodDirectionPanel"
import { probeBadge, probeStatusLabel, probeCardTitle } from "./PodProbePanel"

describe("directionAction", () => {
  test("pending → 记录方向决定（人类阻塞）", () => {
    const action = directionAction({ status: "pending", options: [] })
    assert.equal(action.label, "记录方向决定")
    assert.equal(action.kind, "decide")
    assert.equal(action.tone, "attention")
  })

  test("decided → 已记录方向（不再是阻塞）", () => {
    const action = directionAction({ status: "decided", options: [] })
    assert.equal(action.kind, "recorded")
    assert.equal(action.tone, "done")
    assert.match(action.label, /已记录/)
  })

  test("none → 方向已明确（不打扰用户）", () => {
    const action = directionAction({ status: "none", options: [] })
    assert.equal(action.kind, "idle")
    assert.equal(action.tone, "neutral")
  })

  test("缺省/畸形 → idle，不抛错", () => {
    assert.equal(directionAction(null as any).kind, "idle")
    assert.equal(directionAction({} as any).kind, "idle")
  })
})

describe("directionSummary", () => {
  test("pending 带选项数", () => {
    assert.match(directionSummary({ status: "pending", options: [{ id: "a", title: "A" }, { id: "b", title: "B" }] } as any), /2/)
  })
  test("decided 带用户原话", () => {
    const text = directionSummary({
      status: "decided",
      options: [],
      decisions: [{ id: "d1", optionId: null, userWords: "先做最小闭环", reason: null, source: "user", revision: 1, decidedAt: "2026-11-03T00:00:00Z", options: [] }],
    } as any)
    assert.match(text, /先做最小闭环/)
  })
  test("null → 空串", () => {
    assert.equal(directionSummary(null), "")
  })
})

describe("directionDecisionLabel", () => {
  test("prefers user words, then option title", () => {
    assert.equal(directionDecisionLabel({ userWords: "  用户原话  ", options: [] } as any), "用户原话")
    assert.equal(
      directionDecisionLabel({ userWords: "", optionId: "b", options: [{ id: "b", title: "方案 B" }] } as any),
      "方案 B",
    )
    assert.equal(directionDecisionLabel(null), "")
  })
})

describe("probeBadge", () => {
  test("refutes → 否定假设", () => {
    assert.equal(probeBadge({ conclusion: "refutes" }), "否定假设")
  })
  test("supports / inconclusive", () => {
    assert.equal(probeBadge({ conclusion: "supports" }), "支持假设")
    assert.equal(probeBadge({ conclusion: "inconclusive" }), "尚不能判断")
  })
  test("无报告时用运行状态", () => {
    assert.equal(probeBadge({ status: "running" }), "执行中")
    assert.equal(probeBadge({ status: "queued" }), "排队中")
    assert.equal(probeBadge({ status: "failed" }), "失败")
    assert.equal(probeBadge(null), "未知")
  })
  test("兼容完整 PodProbe 形状（report 嵌套）", () => {
    assert.equal(probeBadge({ report: { conclusion: "refutes" } }), "否定假设")
  })
})

describe("probeStatusLabel / probeCardTitle", () => {
  test("状态文案", () => {
    assert.equal(probeStatusLabel("completed"), "已完成")
    assert.equal(probeStatusLabel("cancelled"), "已取消")
  })
  test("卡片标题用问题（缺失回落 id）", () => {
    assert.equal(probeCardTitle({ id: "p1", request: { question: "能跑吗" } } as any), "能跑吗")
    assert.equal(probeCardTitle({ id: "p2" } as any), "Probe p2")
  })
})
