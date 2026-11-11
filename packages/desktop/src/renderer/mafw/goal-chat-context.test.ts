import { test } from "node:test"
import assert from "node:assert/strict"
import type { PodDetail, PodGoal, PodMember, PodSession } from "@mafw/sdk"
import {
  goalDiscussionTarget,
  shouldOpenTechLeadForGoal,
  shouldShowReturnLead,
  techLeadSessionForGoal,
} from "./goal-chat-context"

function goal(goalId: string, endedAt: string | null = null): PodGoal {
  return {
    id: `pg-${goalId}`,
    podId: "pod_1",
    goalId,
    status: endedAt ? "done" : "active",
    title: goalId,
    phase: null,
    verdict: null,
    stage: { owner: "team", kind: "working" },
    bucket: "in_progress",
    resultReady: false,
    enqueuedAt: "2026-11-11T00:00:00.000Z",
    startedAt: null,
    endedAt,
    activeRevision: 1,
    revision: 1,
  }
}

function member(id: string, role: PodMember["role"]): PodMember {
  return {
    id,
    podId: "pod_1",
    role,
    displayName: role,
    agentName: role,
    modelProvider: null,
    modelId: null,
    status: "available",
    configJson: null,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  }
}

function session(input: {
  id: string
  memberId: string
  goalId: string | null
  node: string | null
  endedAt?: string | null
  scopeKind?: PodSession["scopeKind"]
}): PodSession {
  return {
    id: input.id,
    podId: "pod_1",
    memberId: input.memberId,
    goalId: input.goalId,
    node: input.node,
    sessionId: input.id,
    status: input.endedAt ? "ended" : "active",
    transcriptRef: null,
    scopeKind: input.scopeKind ?? null,
    createdAt: "2026-11-11T00:00:00.000Z",
    endedAt: input.endedAt ?? null,
  }
}

const detail: PodDetail = {
  pod: { id: "pod_1" } as PodDetail["pod"],
  members: [member("lead-1", "lead"), member("tech-1", "tech_lead"), member("builder-1", "builder")],
  stageSupported: true,
  goals: [goal("g1"), goal("g2"), goal("g-ended", "2026-11-11T00:00:00.000Z")],
  attention: [],
  messageHealth: [],
  tasks: [],
  sessions: [
    session({ id: "s-tech", memberId: "tech-1", goalId: "g1", node: "discussion", scopeKind: "discussion" }),
    session({ id: "s-builder", memberId: "builder-1", goalId: "g1", node: "execute" }),
    session({ id: "s-other", memberId: "tech-1", goalId: "g2", node: "discussion", scopeKind: "discussion" }),
    session({ id: "s-tech-ended", memberId: "tech-1", goalId: "g-ended", node: "discussion", scopeKind: "discussion", endedAt: "2026-11-11T01:00:00.000Z" }),
  ],
}

test("only nonterminal Goals enter a live Tech Lead discussion", () => {
  assert.equal(shouldOpenTechLeadForGoal({ endedAt: null }), true)
  assert.equal(shouldOpenTechLeadForGoal({ endedAt: "2026-11-11T00:00:00.000Z" }), false)
  assert.equal(shouldOpenTechLeadForGoal(undefined), false)
  assert.equal(shouldOpenTechLeadForGoal(null), false)
})

test("discussion target reads only the supplied Pod detail", () => {
  assert.equal(goalDiscussionTarget(detail, "g1")?.goalId, "g1")
  assert.equal(goalDiscussionTarget(detail, "missing"), null)
  assert.equal(goalDiscussionTarget(null, "g1"), null)
})

test("Tech Lead session must belong to the selected Goal and live discussion", () => {
  assert.equal(techLeadSessionForGoal({ detail, goalId: "g1", activeSessionId: "s-tech" }), true)
  assert.equal(techLeadSessionForGoal({ detail, goalId: "g1", activeSessionId: "s-builder" }), false)
  assert.equal(techLeadSessionForGoal({ detail, goalId: "g2", activeSessionId: "s-tech" }), false)
  assert.equal(techLeadSessionForGoal({ detail, goalId: null, activeSessionId: "s-tech" }), false)
  assert.equal(techLeadSessionForGoal({ detail, goalId: "g1", activeSessionId: null }), false)
  assert.equal(techLeadSessionForGoal({ detail: null, goalId: "g1", activeSessionId: "s-tech" }), false)
})

test("return Lead is visible only for the selected live nonterminal Goal", () => {
  assert.equal(shouldShowReturnLead({ detail, selectedGoalId: "g1", activeSessionId: "s-tech" }), true)
  assert.equal(shouldShowReturnLead({ detail, selectedGoalId: null, activeSessionId: "s-tech" }), false)
  assert.equal(shouldShowReturnLead({ detail, selectedGoalId: "g2", activeSessionId: "s-tech" }), false)
  assert.equal(shouldShowReturnLead({ detail, selectedGoalId: "g-ended", activeSessionId: "s-tech-ended" }), false)
  assert.equal(shouldShowReturnLead({ detail, selectedGoalId: "missing", activeSessionId: "s-tech" }), false)
})
