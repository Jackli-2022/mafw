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
} from "./pod-model"

const task = (id: string, status: PodTaskStatus, extra: Partial<PodTask> = {}): PodTask => ({
  id,
  podId: "pod_1",
  goalId: null,
  sourceKey: `manual:${id}`,
  externalTaskId: null,
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
})
