import { test } from "node:test"
import assert from "node:assert/strict"
import type { PodDetail, PodGoal, PodMember, PodSession } from "@mafw/sdk"
import { buildPodContacts } from "./pod-contact-model"

function member(id: string, role: PodMember["role"], displayName: string): PodMember {
  return {
    id,
    podId: "pod_1",
    role,
    displayName,
    agentName: `mafw-${role}`,
    modelProvider: null,
    modelId: null,
    status: "available",
    configJson: null,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
  }
}

function goal(goalId: string, status: PodGoal["status"], endedAt: string | null = null): PodGoal {
  return {
    id: `pg-${goalId}`,
    podId: "pod_1",
    goalId,
    status,
    title: "修复语音回声进入输入栏",
    phase: null,
    verdict: null,
    stage: { owner: "team", kind: "implementing" },
    bucket: status === "queued" ? "queued" : endedAt ? "ended" : "in_progress",
    resultReady: false,
    activeRevision: 1,
    revision: 1,
    enqueuedAt: "2026-11-09T00:00:00.000Z",
    startedAt: "2026-11-09T00:01:00.000Z",
    endedAt,
  }
}

function session(sessionId: string, memberId: string, goalId: string | null, endedAt: string | null = null): PodSession {
  return {
    id: `ps-${sessionId}`,
    podId: "pod_1",
    memberId,
    goalId,
    node: goalId ? "discussion" : "coordination",
    sessionId,
    status: endedAt ? "ended" : "active",
    transcriptRef: null,
    scopeKind: goalId ? "discussion" : "project",
    createdAt: "2026-11-09T00:00:00.000Z",
    endedAt,
  }
}

function detail(input: { goals: PodGoal[]; sessions?: PodSession[] }): PodDetail {
  return {
    pod: { id: "pod_1", projectDir: "/project", name: "Project", status: "active" },
    members: [
      member("lead", "lead", "Lead"),
      member("tech", "tech_lead", "Tech Lead"),
      member("builder", "builder", "Builder"),
      member("reviewer", "reviewer", "Reviewer"),
    ],
    goals: input.goals,
    tasks: [],
    sessions: input.sessions ?? [],
    messageHealth: [],
  } as PodDetail
}

test("returns only Lead and Tech Lead in fixed order", () => {
  const rows = buildPodContacts(detail({ goals: [goal("goal-active", "active")] }))
  assert.deepEqual(rows.map((row) => row.role), ["lead", "tech_lead"])
})

test("lead is always openable and tech lead carries the current goal", () => {
  const [lead, tech] = buildPodContacts(detail({ goals: [goal("goal-active", "active")] }))
  assert.equal(lead.canOpen, true)
  assert.equal(tech.goalId, "goal-active")
  assert.match(tech.focusText ?? "", /修复语音回声/)
})

test("no active goal leaves tech lead visible but not openable", () => {
  const [lead, tech] = buildPodContacts(detail({ goals: [goal("old", "done", "2026-11-09T01:00:00.000Z")] }))
  assert.equal(lead.canOpen, true)
  assert.equal(tech.canOpen, false)
  assert.equal(tech.focusText, null)
})

test("a live goal-scoped discussion keeps its own goal and does not expose the runtime id", () => {
  const liveGoal = goal("goal-live", "active")
  const [, tech] = buildPodContacts(detail({
    goals: [goal("goal-active", "active"), liveGoal],
    sessions: [session("ses_hidden_tech", "tech", "goal-live")],
  }))
  assert.equal(tech.goalId, "goal-live")
  assert.match(tech.focusText ?? "", /修复语音回声/)
  assert.doesNotMatch(tech.focusText ?? "", /ses_hidden_tech/)
})
