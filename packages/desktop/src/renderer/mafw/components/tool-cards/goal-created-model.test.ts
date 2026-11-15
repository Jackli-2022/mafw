import { test } from "node:test"
import assert from "node:assert/strict"
import { goalCreatedActionState, goalCreatedView } from "./goal-created-model"

test("tech_lead result becomes an open-discussion card", () => {
  const view = goalCreatedView(
    { title: "修复登录" },
    JSON.stringify({
      success: true,
      routedTo: "tech_lead",
      podId: "pod_1",
      goalId: "g1",
      revision: 1,
      stage: "discussing",
      sessionID: "ses_1",
      sourceRef: { sessionID: "ses_lead" },
    }),
    "completed",
  )
  assert.equal(view.kind, "tech_lead")
  assert.equal(view.title, "修复登录")
  assert.equal(view.goalId, "g1")
  assert.equal(view.sessionID, "ses_1")
  assert.equal(view.hasHandoff, true)
})

test("tech_lead result without a handoff still opens the discussion", () => {
  const view = goalCreatedView(
    { title: "无快照" },
    JSON.stringify({ success: true, routedTo: "tech_lead", goalId: "g2", stage: "discussing" }),
    "completed",
  )
  assert.equal(view.kind, "tech_lead")
  assert.equal(view.hasHandoff, false)
  assert.equal(view.sessionID, null)
})

test("legacy create_goal keeps the generic card", () => {
  const view = goalCreatedView(
    { title: "旧 Goal" },
    JSON.stringify({ success: true, routedTo: "legacy", goalId: "g3" }),
    "completed",
  )
  assert.equal(view.kind, "legacy")
})

test("running tool call is pending", () => {
  const view = goalCreatedView({ title: "进行中" }, undefined, "running")
  assert.equal(view.kind, "pending")
  assert.equal(view.title, "进行中")
})

test("tech lead session failure is surfaced as a warning", () => {
  const view = goalCreatedView(
    { title: "会话失败" },
    JSON.stringify({
      success: true,
      routedTo: "tech_lead",
      goalId: "g4",
      stage: "discussing",
      sessionID: null,
      sessionError: "runtime unavailable",
    }),
    "completed",
  )
  assert.equal(view.kind, "tech_lead")
  assert.equal(view.warning, "runtime unavailable")
})

test("failed and malformed outputs are errors, not actionable cards", () => {
  assert.equal(goalCreatedView({ title: "失败" }, JSON.stringify({ success: false }), "completed").kind, "error")
  assert.equal(goalCreatedView({ title: "坏 JSON" }, "{not-json", "completed").kind, "error")
})

test("wrapped MCP results still find the structured payload", () => {
  const payload = { success: true, routedTo: "tech_lead", goalId: "g5", stage: "discussing" }
  const withStructured = JSON.stringify({
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  })
  const withTextOnly = JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] })
  assert.equal(goalCreatedView({ title: "包装" }, withStructured, "completed").kind, "tech_lead")
  assert.equal(goalCreatedView({ title: "包装" }, withTextOnly, "completed").goalId, "g5")
})

test("only a live, active, discussing Goal can be cancelled", () => {
  const view = goalCreatedView(
    { title: "修复登录" },
    JSON.stringify({ success: true, routedTo: "tech_lead", goalId: "g1", stage: "discussing" }),
    "completed",
  )
  const discussing = { status: "active", stage: "discussing", label: "Tech Lead 讨论中", canCancel: true }
  assert.equal(goalCreatedActionState(view, discussing, false).canCancel, true)
  assert.equal(goalCreatedActionState(view, { ...discussing, stage: "planning", canCancel: false }, false).canCancel, false)
  assert.equal(goalCreatedActionState(view, { ...discussing, status: "done", canCancel: false }, false).canCancel, false)
  assert.equal(goalCreatedActionState(view, { ...discussing, status: "aborted", canCancel: false }, false).canOpen, false)
  assert.equal(goalCreatedActionState(view, null, false).canCancel, false)
  assert.equal(goalCreatedActionState(view, undefined, false).canCancel, false)
  assert.equal(goalCreatedActionState(view, discussing, true).canOpen, false)
})
