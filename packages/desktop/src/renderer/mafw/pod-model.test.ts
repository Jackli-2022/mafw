import { describe, test } from "node:test"
import assert from "node:assert/strict"
import type { PodDetail, PodTask, PodTaskStatus } from "@mafw/sdk"
import {
  formatPodCost,
  groupPodTasks,
  memberOpenTarget,
  podEventAction,
  podEventPodId,
  podIsUnsupported,
  podMemberName,
  podRoleBadge,
  podRoleForSession,
  podShortTime,
  podTaskArtifacts,
  canEditPlanTask,
  podActiveGoalId,
  podTaskAcceptance,
  parseAcceptanceLines,
  formatAcceptanceLines,
  podMessageDeliveryLabel,
  podMessageProtocolLabel,
  podOutgoingDelivery,
  shouldCloseTranscript,
  terminalGoalsNewestFirst,
  podStageLabel,
  podStageTone,
  podGoalResultLabel,
  attentionCount,
  planTaskOnly,
  noteTasksOnly,
  goalQueueRow,
} from "./pod-model"

const task = (id: string, status: PodTaskStatus, extra: Partial<PodTask> = {}): PodTask => ({
  id,
  podId: "pod_1",
  goalId: null,
  sourceKey: `manual:${id}`,
  externalTaskId: null,
  kind: "note",
  title: id,
  description: null,
  ownerMemberId: null,
  status,
  dependenciesJson: null,
  artifactRefsJson: null,
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  ...extra,
})

const detail = (): PodDetail => ({
  pod: {
    id: "pod_1", projectDir: "/p", name: "p", status: "active", configJson: "{}",
    activeGoalId: null, createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z",
  },
  members: [
    { id: "m_lead", podId: "pod_1", role: "lead", displayName: "Lead", agentName: "manager", modelProvider: null, modelId: null, status: "available", configJson: null, createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z" },
    { id: "m_builder", podId: "pod_1", role: "builder", displayName: "Builder", agentName: "mafw-execute", modelProvider: null, modelId: null, status: "working", configJson: null, createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z" },
  ],
  goals: [],
  attention: [],
  messageHealth: [],
  tasks: [],
  sessions: [
    { id: "s_old", podId: "pod_1", memberId: "m_builder", goalId: null, node: "execute", sessionId: "old", status: "ended", transcriptRef: "/old.json", createdAt: "2026-10-30T00:00:00.000Z", endedAt: "2026-10-30T00:00:00.000Z" },
    { id: "s_live", podId: "pod_1", memberId: "m_builder", goalId: null, node: "execute", sessionId: "live", status: "active", transcriptRef: null, createdAt: "2026-10-30T00:01:00.000Z", endedAt: null },
  ],
})

describe("pod-model", () => {
  test("groups tasks into five ordered lanes and keeps createdAt order", () => {
    const lanes = groupPodTasks([
      task("a", "pending"),
      task("b", "blocked"),
      task("c", "review"),
      task("d", "done"),
      task("e", "failed"),
      task("f", "reopened"),
    ])
    assert.deepEqual(lanes.map((lane) => lane.id), ["todo", "in_progress", "review", "done", "failed"])
    assert.deepEqual(lanes.map((lane) => lane.tasks.map((t) => t.id)), [["a", "f"], ["b"], ["c"], ["d"], ["e"]])
  })

  test("event action refreshes a matching pod, looks up when empty, ignores without project", () => {
    const event = { type: "pod.updated", properties: { podId: "pod_1" } }
    assert.equal(podEventPodId(event), "pod_1")
    assert.equal(podEventAction({ currentPodId: "pod_1", projectDir: "/p", event }), "refresh")
    assert.equal(podEventAction({ currentPodId: null, projectDir: "/p", event }), "lookup")
    assert.equal(podEventAction({ currentPodId: null, projectDir: null, event }), "ignore")
    assert.equal(podEventAction({ currentPodId: null, projectDir: "/p", event: { type: "other" } }), "ignore")
  })

  test("detects unsupported gateway from HTTP 404 but not an unregistered project", () => {
    assert.equal(podIsUnsupported(new Error("HTTP 404: Not Found")), true)
    assert.equal(podIsUnsupported(new Error("HTTP 404: project is not registered: /p")), false)
    assert.equal(podIsUnsupported(new Error("HTTP 500: boom")), false)
    assert.equal(podIsUnsupported(new Error("Received HTML instead of JSON from /api/projects/p/pod — gateway is older than the SDK (route missing). Update/restart the gateway.")), true)
  })

  test("orders terminal goals newest first for the queue section", () => {
    const goals = [
      { id: "g_old", status: "done", enqueuedAt: "2026-10-01T00:00:00.000Z", endedAt: "2026-10-02T00:00:00.000Z" },
      { id: "g_active", status: "active", enqueuedAt: "2026-10-03T00:00:00.000Z", endedAt: null },
      { id: "g_new", status: "aborted", enqueuedAt: "2026-10-04T00:00:00.000Z", endedAt: "2026-10-05T00:00:00.000Z" },
    ] as any
    assert.deepEqual(terminalGoalsNewestFirst(goals).map((g) => g.id), ["g_new", "g_old"])
  })

  test("closes a transcript when the loaded pod changes or disappears", () => {
    assert.equal(shouldCloseTranscript("pod_a", "pod_b"), true)
    assert.equal(shouldCloseTranscript("pod_a", null), true)
    assert.equal(shouldCloseTranscript("pod_a", "pod_a"), false)
    assert.equal(shouldCloseTranscript(null, "pod_b"), false)
  })

  test("prefers a live session, falls back to an ended snapshot", () => {
    const d = detail()
    assert.deepEqual(memberOpenTarget(d, "m_builder"), { kind: "session", sessionId: "live" })
    d.sessions[1].endedAt = "2026-10-30T00:10:00.000Z"
    d.sessions[1].transcriptRef = "/live.json"
    assert.deepEqual(memberOpenTarget(d, "m_builder"), { kind: "transcript", sessionId: "live" })
    assert.equal(memberOpenTarget(d, "m_lead"), null)
  })

  test("resolves member names and role badges for sessions", () => {
    const d = detail()
    assert.equal(podMemberName(d, "m_lead"), "Lead")
    assert.equal(podMemberName(d, null), "系统")
    assert.equal(podRoleForSession(d, "live"), "builder")
    assert.equal(podRoleForSession(d, "nope"), null)
    assert.equal(podRoleForSession(null, "live"), null)
    assert.equal(podRoleBadge("lead"), "L")
    assert.equal(podRoleBadge("builder"), "B")
    assert.equal(podRoleBadge("reviewer"), "R")
    assert.equal(podRoleBadge("curator"), "C")
  })

  test("formats cost, time, and task artifacts", () => {
    assert.equal(formatPodCost({ spentUsd: 2.4, limitUsd: 20 }), "$2.40 / $20.00")
    assert.equal(formatPodCost({ spentUsd: 2.4, limitUsd: 0 }), "$2.40 / 不限")
    assert.equal(formatPodCost(null), "—")
    assert.equal(podShortTime("2026-10-30T00:00:00.000Z", Date.parse("2026-10-30T00:00:30.000Z")), "刚刚")
    assert.equal(podShortTime("2026-10-30T00:00:00.000Z", Date.parse("2026-10-30T00:05:00.000Z")), "5m")
    assert.equal(podShortTime("2026-10-29T00:00:00.000Z", Date.parse("2026-10-30T03:00:00.000Z")), "1d")
    assert.equal(podShortTime(null, Date.now()), "")
    assert.deepEqual(podTaskArtifacts(task("a", "pending", { artifactRefsJson: '["a.md","b.md"]' })), ["a.md", "b.md"])
    assert.deepEqual(podTaskArtifacts(task("b", "pending", { artifactRefsJson: "not json" })), [])
  })

  test("labels handoff protocol and delivery state", () => {
    assert.equal(podMessageProtocolLabel({ protocol: "a2a" }), "A2A")
    assert.equal(podMessageProtocolLabel({ protocol: "rest" }), "REST")
    assert.equal(podMessageProtocolLabel({ protocol: null }), null)
    assert.equal(podMessageDeliveryLabel({ deliveredAt: null }), "待投递")
    assert.equal(podMessageDeliveryLabel({ deliveredAt: "2026-10-30T00:00:00.000Z" }), "已投递")
    assert.equal(podMessageDeliveryLabel({}), null)
  })

  test("only outgoing messages carry a delivery badge", () => {
    const lead = "m_lead"
    assert.equal(podOutgoingDelivery({ fromMemberId: lead, deliveredAt: null }, lead), "待送达")
    assert.equal(podOutgoingDelivery({ fromMemberId: lead, deliveredAt: "2026-10-30T00:00:00.000Z" }, lead), "已送达")
    assert.equal(podOutgoingDelivery({ fromMemberId: "m_builder", deliveredAt: null }, lead), null)
    assert.equal(podOutgoingDelivery({ fromMemberId: lead, deliveredAt: null }, null), null)
    assert.equal(podOutgoingDelivery({ fromMemberId: lead, toMemberId: null, deliveredAt: null }, lead), null)
  })

  test("plan task editing is limited to projected tasks", () => {
    assert.equal(canEditPlanTask({ goalId: "g1", externalTaskId: "w1-t1" }), true)
    assert.equal(canEditPlanTask({ goalId: null, externalTaskId: "w1-t1" }), false)
    assert.equal(canEditPlanTask({ goalId: "g1", externalTaskId: null }), false)
  })

  test("podTaskAcceptance parses mirrored acceptance and fails open", () => {
    assert.deepEqual(podTaskAcceptance({ acceptanceJson: JSON.stringify(["跑测试", " 看日志 "]) }), ["跑测试", "看日志"])
    assert.deepEqual(podTaskAcceptance({ acceptanceJson: null }), [])
    assert.deepEqual(podTaskAcceptance({ acceptanceJson: "not json" }), [])
    assert.deepEqual(podTaskAcceptance({ acceptanceJson: JSON.stringify([1, "ok", ""]) }), ["ok"])
  })

  test("parseAcceptanceLines trims, dedupes and caps", () => {
    assert.deepEqual(parseAcceptanceLines(" a \n\n b\r\na\n"), ["a", "b"])
    const many = Array.from({ length: 25 }, (_v, i) => `标准 ${i}`).join("\n")
    assert.equal(parseAcceptanceLines(many).length, 20)
    assert.equal(formatAcceptanceLines(["a", "b"]), "a\nb")
  })

  test("podActiveGoalId picks the single active goal", () => {
    const goal = (goalId: string, status: "queued" | "active" | "done") => ({
      id: `podgoal_${goalId}`, podId: "pod_1", goalId, status,
      title: goalId, phase: null, verdict: null,
      stage: { owner: "team" as const, kind: "working" as const }, resultReady: false,
      enqueuedAt: "2026-10-30T00:00:00.000Z", startedAt: null, endedAt: null,
    })
    assert.equal(podActiveGoalId([goal("q1", "queued"), goal("g1", "active"), goal("d1", "done")]), "g1")
    assert.equal(podActiveGoalId([goal("q1", "queued")]), null)
    assert.equal(podActiveGoalId([]), null)
  })

  test("stage labels never expose internal goal ids", () => {
    assert.equal(podStageLabel({ owner: "person", kind: "plan_approval" }), "等待你批准计划")
    assert.equal(podStageLabel({ owner: "team", kind: "working" }), "团队工作中")
    assert.equal(podStageLabel({ owner: "system", kind: "ended" }), "已结束")
    assert.equal(podStageLabel({ owner: "team", kind: "queued", queueReason: "paused" }), "已暂停，等待恢复")
    assert.equal(podStageLabel({ owner: "team", kind: "queued", queueReason: "budget" }), "等待预算")
    assert.equal(podStageTone({ owner: "person", kind: "question" }), "person")
  })

  test("goal verdict labels never claim failed work completed", () => {
    assert.equal(podGoalResultLabel("PASS"), "已完成")
    assert.equal(podGoalResultLabel("MAX_RETRIES"), "达到轮次上限")
    assert.equal(podGoalResultLabel("FAIL"), "未通过")
    assert.equal(podGoalResultLabel("ERROR"), "技术失败")
    assert.equal(podGoalResultLabel("CANCELLED"), "已取消")
    assert.equal(podGoalResultLabel(null), "已结束")
  })

  test("goal queue renders title and true verdicts", () => {
    assert.equal(goalQueueRow({ title: "Fix Pod", verdict: "MAX_RETRIES", stage: { owner: "system", kind: "ended" } }), "Fix Pod · 达到轮次上限")
    assert.equal(goalQueueRow({ title: "Bad", verdict: "FAIL", stage: { owner: "system", kind: "ended" } }), "Bad · 未通过")
    assert.doesNotMatch(goalQueueRow({ title: "Bad", verdict: "FAIL", stage: { owner: "system", kind: "ended" } }), /完成/)
  })

  test("attention count excludes unread and result-ready", () => {
    assert.equal(attentionCount({ attention: [{ id: "a", goalId: "g", kind: "question", title: "Q", action: { type: "open_question", goalId: "g" } }] }), 1)
    assert.equal(attentionCount({ attention: [] }), 0)
  })

  test("notes are not plan tasks", () => {
    const tasks = [task("a", "pending", { kind: "note" }), task("b", "pending", { kind: "plan", goalId: "g", externalTaskId: "w1-t1" }), task("c", "pending", { kind: "external_request" })]
    assert.deepEqual(planTaskOnly(tasks).map((t) => t.id), ["b"])
    assert.deepEqual(noteTasksOnly(tasks).map((t) => t.id), ["a"])
  })
})
