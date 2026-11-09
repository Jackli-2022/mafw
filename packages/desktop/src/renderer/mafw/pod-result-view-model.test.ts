import { describe, test } from "node:test"
import assert from "node:assert/strict"
import type { PodGoalResult } from "@mafw/sdk"
import {
  podResultAcceptanceView,
  podResultConditionRows,
  podResultWorktreeRows,
} from "./pod-result-view-model"

function result(patch: Partial<PodGoalResult> = {}): PodGoalResult {
  return {
    goalId: "g1",
    revision: 1,
    verdict: "PASS",
    resultReady: true,
    reviewed: true,
    assessment: "reviewed",
    goalAcceptance: [],
    goalConditions: [],
    goalResults: [],
    goalEvalValid: true,
    tasks: [],
    reviewFeedback: "",
    receipt: null,
    artifacts: [],
    worktree: {
      dir: "/repo-wt-g1-r1",
      branch: "mafw/g1-r1",
      baseBranch: "main",
      status: "active",
      mergeCommit: null,
      mergedAt: null,
    },
    acceptance: "pending",
    ...patch,
  }
}

describe("podResultAcceptanceView", () => {
  test("a pending success offers the one-click merge", () => {
    assert.deepEqual(podResultAcceptanceView(result()), {
      actionable: true,
      label: "验收并合并到主分支",
      tone: "success",
    })
  })

  test("a quick unreviewed success is still acceptable when the server says pending", () => {
    const view = podResultAcceptanceView(result({
      verdict: null,
      reviewed: false,
      assessment: "unreviewed",
      acceptance: "pending",
    }))
    assert.equal(view.actionable, true)
    assert.equal(view.tone, "success")
  })

  test("a failed result is explicitly not acceptable", () => {
    assert.deepEqual(podResultAcceptanceView(result({
      verdict: "FAIL",
      acceptance: "unavailable",
    })), {
      actionable: false,
      label: "失败 · 不可验收",
      tone: "failure",
    })
  })

  test("technical failure and retry exhaustion are failures too", () => {
    for (const verdict of ["ERROR", "MAX_RETRIES", "CANCELLED"] as const) {
      const view = podResultAcceptanceView(result({ verdict, acceptance: "unavailable" }))
      assert.equal(view.tone, "failure", verdict)
      assert.equal(view.actionable, false, verdict)
    }
  })

  test("a merged revision shows accepted without another action", () => {
    const view = podResultAcceptanceView(result({
      acceptance: "accepted",
      worktree: {
        ...result().worktree!,
        status: "merged",
        mergeCommit: "abc123",
        mergedAt: "2026-11-09T01:00:00.000Z",
      },
    }))
    assert.equal(view.actionable, false)
    assert.equal(view.tone, "success")
    assert.match(view.label, /已验收/)
  })

  test("a legacy result without a worktree is not acceptable", () => {
    const view = podResultAcceptanceView(result({
      worktree: null,
      acceptance: "unavailable",
    }))
    assert.equal(view.actionable, false)
    assert.equal(view.tone, "neutral")
    assert.match(view.label, /不可验收/)
  })

  test("a missing acceptance field is never treated as pending", () => {
    const view = podResultAcceptanceView(result({ acceptance: undefined }))
    assert.equal(view.actionable, false)
  })
})

describe("podResultWorktreeRows", () => {
  test("an active worktree shows branch, target and pending status", () => {
    const rows = podResultWorktreeRows(result())
    assert.deepEqual(rows.map((row) => row.label), ["分支", "合并到", "状态"])
    assert.deepEqual(rows.map((row) => row.value), ["mafw/g1-r1", "main", "待验收"])
  })

  test("a merged worktree shows the merge commit", () => {
    const rows = podResultWorktreeRows(result({
      acceptance: "accepted",
      worktree: {
        ...result().worktree!,
        status: "merged",
        mergeCommit: "abcdef1234567890",
        mergedAt: "2026-11-09T01:00:00.000Z",
      },
    }))
    assert.deepEqual(rows.map((row) => row.label), ["分支", "合并到", "状态", "合并提交"])
    assert.equal(rows[2].value, "已合并")
    assert.equal(rows[3].value, "abcdef1")
  })

  test("abandoned and missing worktrees carry a warning", () => {
    const abandoned = podResultWorktreeRows(result({
      worktree: { ...result().worktree!, status: "abandoned" },
    }))
    assert.equal(abandoned.find((row) => row.label === "状态")?.tone, "warning")
    const missing = podResultWorktreeRows(result({
      worktree: { ...result().worktree!, status: "missing" },
    }))
    assert.equal(missing.find((row) => row.label === "状态")?.tone, "danger")
  })

  test("a legacy result renders no worktree card rows", () => {
    assert.deepEqual(podResultWorktreeRows(result({ worktree: null })), [])
    assert.deepEqual(podResultWorktreeRows(result({ worktree: undefined })), [])
  })

  test("a detached base branch is shown as unknown, not blank", () => {
    const rows = podResultWorktreeRows(result({
      worktree: { ...result().worktree!, baseBranch: null },
    }))
    assert.equal(rows.find((row) => row.label === "合并到")?.value, "未知")
  })
})

describe("podResultConditionRows", () => {
  test("conditions pair with results by id", () => {
    const rows = podResultConditionRows(result({
      goalConditions: [
        { id: "g1", statement: "构建通过", required: true },
        { id: "g2", statement: "文档更新", required: false },
      ],
      goalResults: [
        { id: "g1", result: "pass", evidence: "npm test 42/42" },
        { id: "g2", result: "skipped", evidence: "README 未涉及" },
      ],
    }))
    assert.deepEqual(rows, [
      { id: "g1", statement: "构建通过", required: true, result: "通过", evidence: "npm test 42/42" },
      { id: "g2", statement: "文档更新", required: false, result: "跳过", evidence: "README 未涉及" },
    ])
  })

  test("a condition without a result renders as undetermined, never pass", () => {
    const rows = podResultConditionRows(result({
      goalConditions: [{ id: "g1", statement: "构建通过", required: true }],
      goalResults: [],
    }))
    assert.equal(rows[0].result, "未判定")
    assert.equal(rows[0].evidence, "")
  })

  test("an unknown result id is surfaced after the declared conditions", () => {
    const rows = podResultConditionRows(result({
      goalConditions: [{ id: "g1", statement: "构建通过", required: true }],
      goalResults: [
        { id: "g1", result: "pass", evidence: "ok" },
        { id: "g9", result: "fail", evidence: "未声明却失败" },
      ],
    }))
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[1], {
      id: "g9",
      statement: "未在 Goal Eval 中声明的条件",
      required: false,
      result: "失败",
      evidence: "未声明却失败",
    })
  })

  test("duplicate results keep the first verdict only", () => {
    const rows = podResultConditionRows(result({
      goalConditions: [{ id: "g1", statement: "构建通过", required: true }],
      goalResults: [
        { id: "g1", result: "pass", evidence: "first" },
        { id: "g1", result: "fail", evidence: "second" },
      ],
    }))
    assert.equal(rows[0].result, "通过")
    assert.equal(rows[0].evidence, "first")
  })

  test("missing eval data renders nothing", () => {
    assert.deepEqual(podResultConditionRows(result({ goalConditions: undefined, goalResults: undefined })), [])
    assert.deepEqual(podResultConditionRows(result({ goalConditions: [], goalResults: [] })), [])
  })
})
