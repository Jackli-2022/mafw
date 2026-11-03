// Task 13 契约：一个 Goal 详情承载计划、问题、方向、结果与打回；
// attention 必须按 action.type 分流，不能全部落到无动作的执行时间线。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import {
  attentionTarget,
  planEditGate,
  podResultAssessmentLabel,
  rejectButtonLabel,
} from "../src/renderer/mafw/pod-model"
import { buildGoalLanes, hideEmptyReviewLane } from "../src/renderer/mafw/goal-timeline"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const detail = read("../src/renderer/mafw/components/GoalDetailOverlay.tsx")
const resultView = read("../src/renderer/mafw/components/PodResultView.tsx")
const workOverview = read("../src/renderer/mafw/components/WorkOverview.tsx")
const board = read("../src/renderer/mafw/components/PodTaskBoard.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("结果正文只有一个实现：PodResultView", () => {
  assert.match(resultView, /window\.api\.mafw\.pod\.result\(/)
  assert.match(resultView, /revisionHistory\(/)
  assert.match(resultView, /rejectButtonLabel\(/)
  assert.match(resultView, /markResultViewedAfterLoad\(/)
  assert.match(resultView, /TextareaV2/)
  assert.match(resultView, /export function PodResultView/)

  // Task 15：旧的独立结果末端已退役，结果只在统一 Goal 详情里出现。
  assert.equal(existsSync(new URL("../src/renderer/mafw/components/PodResultPanel.tsx", import.meta.url)), false)
})

test("Goal 详情直接包含结果与打回，不再依赖独立的 Goal 结果入口", () => {
  assert.match(detail, /import \{ PodResultView \}/)
  assert.match(detail, /<PodResultView/)
  assert.match(detail, /rejectResult\(/)
  // 取消/中止的 Goal 有终态 verdict 但没有结果证据，不能渲染结果卡。
  assert.match(detail, /goal\.status === "aborted"\) return false/)
  assert.match(resultView, /podResultAssessmentLabel\(/)
  assert.equal(podResultAssessmentLabel({ verdict: null, assessment: "unreviewed" }), "未独立评审")
  assert.equal(podResultAssessmentLabel({ verdict: "PASS", assessment: "reviewed" }), null)

  const quick = rejectButtonLabel({ status: "completed" })
  const collaborative = rejectButtonLabel({ status: "completed" })
  assert.equal(quick, "打回并继续讨论")
  assert.equal(collaborative, "打回并继续讨论")
  // 打回只看 revision 是否收尾，与 verdict/quick 无关：quick 没有业务 verdict 也能打回。
  assert.notEqual(rejectButtonLabel({ status: "implementing" }), "打回并继续讨论")
})

test("attention 按 action.type 分流到计划/问题/方向/结果", () => {
  assert.equal(attentionTarget({ type: "open_plan_review" }), "plan")
  assert.equal(attentionTarget({ type: "open_question" }), "question")
  assert.equal(attentionTarget({ type: "open_direction_review" }), "direction")
  assert.equal(attentionTarget({ type: "open_result" }), "result")
  assert.equal(attentionTarget({ type: "open_goal" }), "timeline")
  assert.equal(attentionTarget({ type: "open_discussion" }), "timeline")

  // needs_you 就是 attention 列表本身；打开时必须带 action 对应的落点。
  assert.match(workOverview, /attentionTarget\(goal\.stage\.action\)/)
  assert.match(shell, /openGoalDetail\(/)
  assert.match(shell, /focus=\{goalDetailFocus\(\)\}/)
})

test("Goal 详情展示问题回答入口，复用既有 goals.respondQuestion", () => {
  assert.match(detail, /approvals\.list\(\)/)
  assert.match(detail, /goals\.respondQuestion\(/)
  assert.match(detail, /回答/)
  assert.match(detail, /pendingQuestion|questionId/)
})

test("任务板按显式 goalId 过滤，Goal 详情不再依赖全局 active goal", () => {
  assert.match(board, /goalId\?: string \| null/)
  assert.match(board, /task\.goalId === props\.goalId/)
  assert.match(detail, /<PodTaskBoard/)
  assert.match(detail, /scope="plan"/)
  assert.match(detail, /goalId=\{props\.goalId\}/)
  assert.doesNotMatch(board, /planGoalId/)
})

test("运行中的计划不可编辑，只有人工批准/等待回答时才显示编辑动作", () => {
  assert.equal(planEditGate({ terminal: false, stage: { kind: "plan_approval" } }).editable, true)
  assert.equal(planEditGate({ terminal: false, stage: { kind: "question" } }).editable, true)
  for (const kind of ["discussing", "planning", "probing", "implementing", "reviewing", "blocked", "ended"]) {
    const gate = planEditGate({ terminal: false, stage: { kind } })
    assert.equal(gate.editable, false, kind)
    assert.ok(gate.reason, `${kind} 必须给出不可编辑原因`)
  }
  assert.equal(planEditGate({ terminal: true, stage: { kind: "plan_approval" } }).editable, false)
  assert.match(detail, /planEditGate\(/)
})

test("quick Goal 不渲染空 Reviewer 泳道，历史评审证据仍保留", () => {
  const empty = buildGoalLanes([], 1).lanes
  assert.deepEqual(
    hideEmptyReviewLane(empty, "quick").map((lane) => lane.node),
    ["plan", "execute"],
  )
  assert.deepEqual(
    hideEmptyReviewLane(empty, "collaborative").map((lane) => lane.node),
    ["plan", "execute", "review"],
  )

  const history = buildGoalLanes([{
    runId: 1, loop: 1, node: "review", attempt: 1, status: "succeeded",
    sessionId: "ses_r", startedAt: "2026-11-03T00:00:00.000Z",
    finishedAt: "2026-11-03T00:01:00.000Z", durationMs: 60000,
    outcome: "PASS", error: null, tokensInput: 1, tokensOutput: 1, costUsd: 0,
  }], 1).lanes
  assert.deepEqual(
    hideEmptyReviewLane(history, "quick").map((lane) => lane.node),
    ["plan", "execute", "review"],
  )
  assert.match(detail, /hideEmptyReviewLane\(/)
})
