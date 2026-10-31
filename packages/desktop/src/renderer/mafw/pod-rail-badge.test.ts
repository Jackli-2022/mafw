import { test } from "node:test"
import assert from "node:assert/strict"
import { countUnread, formatRailBadge, podRailBadge } from "./pod-rail-badge"

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

test("badge = review tasks + unread messages", () => {
  const tasks = [{ status: "review" }, { status: "review" }, { status: "in_progress" }, { status: "done" }]
  assert.equal(podRailBadge({ tasks, messages: [msg({})], selfMemberId: "m_lead" }), 3)
  assert.equal(podRailBadge({ tasks: [], messages: [], selfMemberId: "m_lead" }), 0)
})

test("badge caps rendering at 9+", () => {
  assert.equal(formatRailBadge(0), "")
  assert.equal(formatRailBadge(3), "3")
  assert.equal(formatRailBadge(9), "9")
  assert.equal(formatRailBadge(10), "9+")
})
