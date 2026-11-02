import { test } from "node:test"
import assert from "node:assert/strict"
import { countUnread, formatRailBadge, podRailBadge, podResultBadge } from "./pod-rail-badge"

const msg = (over: Partial<{ readAt: string | null; fromMemberId: string; toMemberId: string | null }>) => ({
  readAt: null,
  fromMemberId: "m_builder",
  toMemberId: "m_lead",
  ...over,
})

test("unread counts only messages addressed to me or broadcast, not mine, not read", () => {
  assert.equal(countUnread([msg({})], "m_lead"), 1)
  assert.equal(countUnread([msg({ toMemberId: null })], "m_lead"), 1)
  assert.equal(countUnread([msg({ fromMemberId: "m_lead" })], "m_lead"), 0)
  assert.equal(countUnread([msg({ readAt: "2026-10-30T00:00:00.000Z" })], "m_lead"), 0)
  assert.equal(countUnread([msg({ toMemberId: "m_reviewer" })], "m_lead"), 0)
  assert.equal(countUnread([msg({})], null), 0)
})

test("badge = human attention only, never unread or result-ready", () => {
  const attention = [
    { id: "a", goalId: "g1", kind: "plan_approval" as const, title: "Plan", action: { type: "open_plan_review" as const, goalId: "g1" } },
    { id: "b", goalId: "g1", kind: "question" as const, title: "Question", action: { type: "open_question" as const, goalId: "g1", questionId: "q1" } },
  ]
  assert.equal(podRailBadge({ attention }), 2)
  assert.equal(podRailBadge({ attention: [] }), 0)
  // Task 21：未读消息与「有新结果」都不是人类阻塞点，数字徽标不掺入。
  assert.equal(podRailBadge({ attention: [], unread: 7, resultReady: true }), 0)
  assert.equal(podRailBadge({ attention, unread: 7, resultReady: true }), 2)
})

test("badge caps rendering at 9+", () => {
  assert.equal(formatRailBadge(0), "")
  assert.equal(formatRailBadge(3), "3")
  assert.equal(formatRailBadge(9), "9")
  assert.equal(formatRailBadge(10), "9+")
})

test("result badge is a separate unviewed marker (not a count)", () => {
  assert.equal(podResultBadge({ resultReady: true, viewed: false }), "result")
  assert.equal(podResultBadge({ resultReady: true, viewed: true }), null)
})
