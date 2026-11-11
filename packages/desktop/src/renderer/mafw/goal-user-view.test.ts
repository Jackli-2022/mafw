import { test } from "node:test"
import assert from "node:assert/strict"
import type { PodGoal, PodGoalStage } from "@mafw/sdk"
import { goalUserActionIntent, goalUserFace, summarizeGoalForUser } from "./goal-user-view"

function goal(input: Partial<PodGoal> & Pick<PodGoal, "goalId">): PodGoal {
  const stage: PodGoalStage = { owner: "team", kind: "working" }
  return {
    id: `pg-${input.goalId}`,
    podId: "pod_1",
    status: "active",
    title: input.goalId,
    phase: null,
    verdict: null,
    stage,
    bucket: "in_progress",
    resultReady: false,
    enqueuedAt: "2026-11-11T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    activeRevision: 1,
    revision: 1,
    ...input,
  }
}

test("Goal user face follows direction, progress, result and history", () => {
  assert.equal(goalUserFace(goal({
    goalId: "direction",
    stage: { owner: "person", kind: "direction_review" },
  })), "direction")
  assert.equal(goalUserFace(goal({
    goalId: "progress",
    stage: { owner: "team", kind: "working" },
  })), "progress")
  assert.equal(goalUserFace(goal({
    goalId: "result",
    bucket: "result_ready",
    resultReady: true,
  })), "result")
  assert.equal(goalUserFace(goal({
    goalId: "history",
    endedAt: "2026-11-11T00:00:00.000Z",
  })), "history")
})

test("plan approval is a direction decision with a person action", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "plan-approval",
    bucket: "needs_you",
    stage: {
      owner: "person",
      kind: "plan_approval",
      action: { type: "open_plan_review", goalId: "plan-approval" },
    },
  }))
  assert.equal(summary.face, "direction")
  assert.equal(summary.statusLabel, "计划待确认")
  assert.equal(summary.nextActionLabel, "审阅计划")
  assert.equal(summary.needsPerson, true)
  assert.equal(summary.ownerLabel, "Tech Lead")
})

test("progress uses real task counts without execution role labels", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "working",
    progress: { total: 4, done: 2, inProgress: 1, review: 0, failed: 0, skipped: 0 },
  }))
  assert.equal(summary.face, "progress")
  assert.equal(summary.statusLabel, "正在推进")
  assert.equal(summary.progressText, "2/4 项任务")
  assert.equal(summary.progressPercent, 50)
  assert.equal(summary.nextActionLabel, null)
  assert.equal(summary.needsPerson, false)
})

test("missing progress stays unknown instead of becoming zero", () => {
  const summary = summarizeGoalForUser(goal({ goalId: "no-progress" }))
  assert.equal(summary.progressText, null)
  assert.equal(summary.progressPercent, null)
  const zero = summarizeGoalForUser(goal({
    goalId: "zero-progress",
    progress: { total: 0, done: 0, inProgress: 0, review: 0, failed: 0, skipped: 0 },
  }))
  assert.equal(zero.progressText, null)
  assert.equal(zero.progressPercent, null)
})

test("old gateways without stage or bucket degrade to readable progress", () => {
  const summary = summarizeGoalForUser({
    ...goal({ goalId: "legacy" }),
    stage: undefined as any,
    bucket: undefined as any,
  })
  assert.equal(summary.face, "progress")
  assert.equal(summary.statusLabel, "正在推进")
  assert.equal(summary.progressPercent, null)
  assert.equal(summary.nextActionLabel, null)
})

test("questions surface a human action while remaining a progress face", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "question",
    bucket: "needs_you",
    stage: {
      owner: "person",
      kind: "question",
      action: { type: "open_question", goalId: "question" },
    },
  }))
  assert.equal(summary.face, "progress")
  assert.equal(summary.statusLabel, "等待你的回答")
  assert.equal(summary.nextActionLabel, "回答问题")
  assert.equal(summary.needsPerson, true)
})

test("blocked goals distinguish execution failure from a plain blocker", () => {
  const failed = summarizeGoalForUser(goal({
    goalId: "failed",
    lastError: "worktree_unavailable",
    stage: { owner: "person", kind: "blocked" },
  }))
  assert.equal(failed.statusLabel, "执行失败")
  assert.equal(failed.nextActionLabel, "重试")
  assert.equal(failed.needsPerson, true)

  const blocked = summarizeGoalForUser(goal({
    goalId: "blocked",
    stage: { owner: "person", kind: "blocked" },
  }))
  assert.equal(blocked.statusLabel, "需要处理阻塞")
  assert.equal(blocked.nextActionLabel, "处理阻塞")
  assert.equal(blocked.needsPerson, true)
})

test("results surface acceptance even without an explicit stage action", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "result",
    bucket: "result_ready",
    resultReady: true,
  }))
  assert.equal(summary.face, "result")
  assert.equal(summary.statusLabel, "结果待验收")
  assert.equal(summary.nextActionLabel, "查看结果")
  assert.equal(summary.needsPerson, true)
  assert.equal(summary.resultReady, true)
})

test("ended goals are history and never claim to need a person", () => {
  const withResult = summarizeGoalForUser(goal({
    goalId: "ended-result",
    resultReady: true,
    endedAt: "2026-11-11T00:00:00.000Z",
  }))
  assert.equal(withResult.face, "history")
  assert.equal(withResult.statusLabel, "已结束")
  assert.equal(withResult.nextActionLabel, "查看结果")
  assert.equal(withResult.ownerLabel, "已结束")
  assert.equal(withResult.needsPerson, false)

  const withoutResult = summarizeGoalForUser(goal({
    goalId: "ended-history",
    endedAt: "2026-11-11T00:00:00.000Z",
  }))
  assert.equal(withoutResult.nextActionLabel, "查看历史")
})

test("unknown person-owned stages still produce a human action", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "unknown-person",
    stage: {
      owner: "person",
      kind: "waiting",
      action: { type: "open_goal", goalId: "unknown-person" },
    },
  }))
  assert.equal(summary.face, "progress")
  assert.equal(summary.statusLabel, "需要你处理")
  assert.equal(summary.nextActionLabel, "处理当前事项")
  assert.equal(summary.needsPerson, true)
})

test("discussion direction stays readable without inventing a next action", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "discussing",
    bucket: "needs_you",
    stage: { owner: "tech_lead", kind: "discussing" },
  }))
  assert.equal(summary.face, "direction")
  assert.equal(summary.statusLabel, "方向讨论中")
  assert.equal(summary.nextActionLabel, null)
  assert.equal(summary.needsPerson, false)
})

test("user-facing labels never expose runtime or internal Goal identity", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "goal-20261111-internal",
    stage: { owner: "team", kind: "working" },
  }))
  const visible = [
    summary.statusLabel,
    summary.ownerLabel,
    summary.nextActionLabel,
    summary.progressText,
  ].filter(Boolean).join(" ")
  assert.doesNotMatch(visible, /ses_|goal-2026|runtime/i)
  // goalId is a routing identity and may stay on the model, but it must not
  // become user-visible copy.
  assert.equal(summary.goalId, "goal-20261111-internal")
})

test("unknown revision stays unknown instead of fabricating revision 1", () => {
  const summary = summarizeGoalForUser(goal({
    goalId: "no-revision",
    activeRevision: undefined as any,
    revision: undefined as any,
    stage: { owner: "team", kind: "working" },
  }))
  assert.equal(summary.revision, null)
})

test("primary Goal action intent never falls through to technical details", () => {
  const empty = { hasResult: false, hasPendingQuestion: false, hasPendingPlan: false, hasDirectionPending: false, hasRetryTarget: false }
  assert.equal(goalUserActionIntent(goal({ goalId: "plan" }), { ...empty, hasPendingPlan: true }), "review_plan")
  assert.equal(goalUserActionIntent(goal({ goalId: "question" }), { ...empty, hasPendingQuestion: true }), "answer_question")
  assert.equal(goalUserActionIntent(goal({
    goalId: "direction",
    stage: { owner: "person", kind: "direction_review" },
  }), empty), "review_direction")
  assert.equal(goalUserActionIntent(goal({ goalId: "result", resultReady: true }), { ...empty, hasResult: true }), "view_result")
  assert.equal(goalUserActionIntent(goal({ goalId: "retry", lastError: "boom" }), { ...empty, hasRetryTarget: true }), "retry")
  assert.equal(goalUserActionIntent(goal({ goalId: "blocked", lastError: "boom" }), empty), "blocker")
  assert.equal(goalUserActionIntent(goal({
    goalId: "blocked-no-error",
    stage: { owner: "person", kind: "blocked" },
  }), empty), "blocker")
  assert.equal(goalUserActionIntent(goal({ goalId: "healthy" }), empty), null)
})
