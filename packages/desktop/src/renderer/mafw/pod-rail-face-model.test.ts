import { test } from "node:test"
import assert from "node:assert/strict"
import { buildMemberRows, canNotify, deliveryToast, podCounts, podEmptyState } from "./pod-rail-face-model"

const detail = {
  members: [
    { id: "m_b", role: "builder", displayName: "Builder", agentName: "mafw-execute", status: "available" },
    { id: "m_l", role: "lead", displayName: "Lead", agentName: "manager", status: "working" },
    { id: "m_r", role: "reviewer", displayName: "Reviewer", agentName: "mafw-review", status: "sleeping" },
  ],
  sessions: [{ memberId: "m_l", sessionId: "ses_1", endedAt: null }],
  tasks: [{ status: "review" }, { status: "pending" }, { status: "done" }],
} as any

test("member rows keep lead → builder → reviewer order and resolve the current action", () => {
  const rows = buildMemberRows(detail, (id) => (id === "ses_1" ? "Pod 收尾" : null))
  assert.deepEqual(rows.map((row) => row.id), ["m_l", "m_b", "m_r"])
  assert.equal(rows[0].action, "会话中 · Pod 收尾")
  assert.equal(rows[0].dotClass, "working")
  assert.equal(rows[0].sessionId, "ses_1")
  assert.equal(rows[1].sessionId, null)
  assert.equal(rows[1].action, "待命")
  assert.equal(rows[2].dotClass, "sleeping")
  assert.equal(rows[2].action, "休眠")
})

test("ended sessions and missing titles fall back honestly", () => {
  const stale = { ...detail, sessions: [{ memberId: "m_l", sessionId: "ses_9", endedAt: "2026-10-30T00:00:00.000Z" }] } as any
  assert.equal(buildMemberRows(stale, () => "x")[0].sessionId, null)
  const titled = { ...detail, sessions: [{ memberId: "m_l", sessionId: "ses_9", endedAt: null }] } as any
  assert.equal(buildMemberRows(titled, () => null)[0].action, "会话中 · 会话中")
})

test("the newest open session wins by createdAt, not by id", () => {
  const two = {
    ...detail,
    sessions: [
      { memberId: "m_l", sessionId: "ses_a", endedAt: null, createdAt: "2026-10-01T00:00:00.000Z" },
      { memberId: "m_l", sessionId: "ses_z", endedAt: null, createdAt: "2026-10-30T00:00:00.000Z" },
    ],
  } as any
  assert.equal(buildMemberRows(two, () => "t")[0].sessionId, "ses_z")
})

test("unknown roles sort after the reviewer instead of before the lead", () => {
  const withCurator = {
    ...detail,
    members: [
      { id: "m_c", role: "curator", displayName: "Curator", agentName: "memory-curator", status: "available" },
      ...detail.members,
    ],
  } as any
  assert.deepEqual(buildMemberRows(withCurator, () => null).map((row) => row.id), ["m_l", "m_b", "m_r", "m_c"])
})

test("counts split review / todo / unread", () => {
  const messages = [
    { readAt: null, fromMemberId: "m_b", toMemberId: "m_l" },
    { readAt: "2026-10-30T00:00:00.000Z", fromMemberId: "m_b", toMemberId: "m_l" },
  ]
  assert.deepEqual(podCounts(detail, messages, "m_l"), { review: 1, todo: 1, inbox: 1 })
})

test("notify is only offered to a named member with an active session", () => {
  assert.equal(canNotify("m_b", true), true)
  assert.equal(canNotify("m_b", false), false)
  assert.equal(canNotify(null, true), false)
})

test("delivery toast never promises a push it cannot confirm", () => {
  assert.equal(deliveryToast("delivered"), "已提醒")
  assert.equal(deliveryToast("pending"), "已发送，对方下次派活时送达")
  assert.equal(deliveryToast("disabled"), "已发送（投递状态未知）")
  assert.equal(deliveryToast(undefined), "已发送（投递状态未知）")
})

test("empty state prefers unsupported over worktree over create", () => {
  assert.equal(podEmptyState({ hasPod: false, unsupported: true, isWorktree: true }), "unsupported")
  assert.equal(podEmptyState({ hasPod: false, unsupported: false, isWorktree: true }), "worktree")
  assert.equal(podEmptyState({ hasPod: false, unsupported: false, isWorktree: false }), "create")
  assert.equal(podEmptyState({ hasPod: true, unsupported: false, isWorktree: true }), "ready")
})
