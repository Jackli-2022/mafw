import { test } from "node:test"
import assert from "node:assert/strict"
import { boundaryTriggerLabel, currentTopicBoundaries, visibleBoundaryProposals } from "./boundary-card"

const boundary = (id: string, status: "proposed" | "accepted" | "merged") => ({
  id,
  projectDir: "/p",
  leadSessionId: "ses_lead",
  fromTopicId: "t1",
  toTopicId: null,
  trigger: "explicit",
  confidence: 0.9,
  status,
  text: "换个话题",
  createdAt: "2026-11-15T00:00:00.000Z",
}) as any

test("only proposed boundaries are actionable, capped in transcript", () => {
  const items = [boundary("a", "proposed"), boundary("b", "accepted"), boundary("c", "proposed")]
  assert.deepEqual(visibleBoundaryProposals(items, 1).map((row) => row.id), ["a"])
  assert.equal(visibleBoundaryProposals(items).length, 2)
})

test("boundary triggers get human labels", () => {
  assert.equal(boundaryTriggerLabel("explicit"), "显式换话题")
  assert.equal(boundaryTriggerLabel("idle"), "空闲 30 分钟")
  assert.equal(boundaryTriggerLabel("semantic"), "语义变化")
  assert.equal(boundaryTriggerLabel("goal_closed"), "Goal 已结束")
  assert.equal(boundaryTriggerLabel("keyword"), "关键词")
  assert.equal(boundaryTriggerLabel("custom"), "custom")
})

test("current-topic boundaries filter before the cap", () => {
  const items = [
    { ...boundary("other", "proposed"), fromTopicId: "t2" },
    { ...boundary("b", "proposed"), fromTopicId: "t1" },
    { ...boundary("c", "proposed"), fromTopicId: "t1" },
  ]
  assert.deepEqual(currentTopicBoundaries("t1", items, 1).map((row) => row.id), ["b"])
  assert.deepEqual(currentTopicBoundaries(null, items), [])
})
