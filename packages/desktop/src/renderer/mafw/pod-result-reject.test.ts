// Task 21：结果通知 / 打回 / revision 历史的纯逻辑契约。
//
// 不变量：
//   1. 结果状态必须带 revision 前缀（「revision 2 · 已通过」），旧版结果不冒充当前版。
//   2. 只有已收尾的 revision 可以打回；打回文案单一来源。
//   3. 未查看的结果有独立标记，跟人类阻塞 attention 分开。
//   4. 打回不删除旧 revision：历史行按新→旧保留 verdict / feedback。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  goalRevisionOf,
  latestUnviewedResult,
  rejectButtonLabel,
  rejectErrorMessage,
  resultStatus,
  revisionHistory,
  revisionStatusLabel,
} from "./pod-model"
import {
  addViewedResult,
  parseViewedResults,
  podResultBadge,
  resultViewedKey,
} from "./pod-rail-badge"
import { readViewedResults, saveViewedResults, VIEWED_RESULTS_STORAGE_KEY } from "./pod-result-store"

type GoalLike = {
  goalId: string
  title?: string
  resultReady?: boolean
  verdict?: "PASS" | "FAIL" | "MAX_RETRIES" | "ERROR" | "CANCELLED" | null
  revision?: number | null
  endedAt?: string | null
  enqueuedAt?: string
}

const goal = (over: GoalLike & { goalId: string }): GoalLike => ({
  title: over.goalId,
  resultReady: true,
  verdict: "PASS",
  revision: 1,
  endedAt: "2026-11-01T00:00:00.000Z",
  enqueuedAt: "2026-10-31T00:00:00.000Z",
  ...over,
})

describe("resultStatus（结果 + revision 前缀）", () => {
  test("PASS 带 revision", () => {
    assert.equal(resultStatus({ verdict: "PASS", revision: 2 }), "revision 2 · 已通过")
  })

  test("失败类 verdict 用既有中文标签", () => {
    assert.equal(resultStatus({ verdict: "FAIL", revision: 1 }), "revision 1 · 未通过")
    assert.equal(resultStatus({ verdict: "MAX_RETRIES", revision: 3 }), "revision 3 · 达到轮次上限")
    assert.equal(resultStatus({ verdict: "ERROR", revision: 2 }), "revision 2 · 技术失败")
  })

  test("无 verdict / 无 revision 时不臆造", () => {
    assert.equal(resultStatus({ verdict: null, revision: 2 }), "revision 2 · 已结束")
    assert.equal(resultStatus({ verdict: "PASS" }), "已通过")
    assert.equal(resultStatus({ verdict: "PASS", revision: 0 }), "已通过")
    assert.equal(resultStatus({ verdict: "PASS", revision: null }), "已通过")
  })
})

describe("rejectButtonLabel / rejectErrorMessage", () => {
  test("只有已收尾的版本可打回", () => {
    assert.equal(rejectButtonLabel({ status: "completed" }), "打回并继续讨论")
    assert.equal(rejectButtonLabel({ status: "aborted" }), "打回并继续讨论")
    assert.equal(rejectButtonLabel({ status: "discussing" }), null)
    assert.equal(rejectButtonLabel({ status: "implementing" }), null)
    assert.equal(rejectButtonLabel({ status: "reviewing" }), null)
    assert.equal(rejectButtonLabel({ status: "discarded" }), null)
    assert.equal(rejectButtonLabel({ status: null }), null)
    assert.equal(rejectButtonLabel({ status: "unknown-status" }), null)
  })

  test("打回失败按 HTTP 状态给可读原因", () => {
    assert.match(rejectErrorMessage(400) ?? "", /原因/)
    assert.match(rejectErrorMessage(409) ?? "", /已收尾|正在/)
    assert.match(rejectErrorMessage(404) ?? "", /不存在/)
    assert.match(rejectErrorMessage(503) ?? "", /不支持/)
    assert.match(rejectErrorMessage(500) ?? "", /打回失败/)
    assert.match(rejectErrorMessage(null) ?? "", /打回失败/)
  })
})

describe("podResultBadge（未查看结果独立标记）", () => {
  test("未查看结果 → result；查看后 / 无结果 → null", () => {
    assert.equal(podResultBadge({ resultReady: true, viewed: false }), "result")
    assert.equal(podResultBadge({ resultReady: true, viewed: true }), null)
    assert.equal(podResultBadge({ resultReady: false, viewed: false }), null)
    assert.equal(podResultBadge({ resultReady: undefined, viewed: false }), null)
  })
})

describe("viewed 存储键", () => {
  test("按 pod/goal/revision 隔离", () => {
    assert.equal(resultViewedKey("pod_1", "g1", 2), "pod_1:g1:2")
    assert.notEqual(resultViewedKey("pod_1", "g1", 1), resultViewedKey("pod_1", "g1", 2))
    assert.notEqual(resultViewedKey("pod_1", "g1", 1), resultViewedKey("pod_2", "g1", 1))
  })

  test("addViewedResult 去重 + 限量（保留最新）", () => {
    assert.deepEqual(addViewedResult([], "a:b:1"), ["a:b:1"])
    assert.deepEqual(addViewedResult(["a:b:1"], "a:b:1"), ["a:b:1"])
    assert.deepEqual(addViewedResult(["a:b:1", "a:b:2"], "a:b:3", 2), ["a:b:2", "a:b:3"])
  })

  test("parseViewedResults 对坏数据 fail-open", () => {
    assert.deepEqual(parseViewedResults(null), [])
    assert.deepEqual(parseViewedResults(""), [])
    assert.deepEqual(parseViewedResults("not json"), [])
    assert.deepEqual(parseViewedResults('{"a":1}'), [])
    assert.deepEqual(parseViewedResults('["a",1,"b"]'), ["a", "b"])
  })

  test("readViewedResults / saveViewedResults 走同一存储键（fail-open）", () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
    }
    assert.deepEqual(readViewedResults(storage), [])
    saveViewedResults(["pod_1:g1:2"], storage)
    assert.equal(map.get(VIEWED_RESULTS_STORAGE_KEY), '["pod_1:g1:2"]')
    assert.deepEqual(readViewedResults(storage), ["pod_1:g1:2"])
    map.set(VIEWED_RESULTS_STORAGE_KEY, "broken")
    assert.deepEqual(readViewedResults(storage), [])
    // 写失败（配额/隐私模式）不能抛
    saveViewedResults(["x"], { getItem: () => null, setItem: () => { throw new Error("quota") } })
  })
})

describe("goalRevisionOf / latestUnviewedResult", () => {
  test("revision 只认正整数（旧 gateway 缺省 → null）", () => {
    assert.equal(goalRevisionOf({ revision: 3 }), 3)
    assert.equal(goalRevisionOf({ revision: null }), null)
    assert.equal(goalRevisionOf({}), null)
    assert.equal(goalRevisionOf({ revision: 0 }), null)
    assert.equal(goalRevisionOf({ revision: -1 }), null)
    assert.equal(goalRevisionOf({ revision: "2" as any }), null)
  })

  test("挑最新的未查看结果", () => {
    const viewed = new Set([resultViewedKey("pod_1", "g2", 1)])
    const goals = [
      goal({ goalId: "g1", endedAt: "2026-11-01T00:00:00.000Z", revision: 2 }),
      goal({ goalId: "g2", endedAt: "2026-11-02T00:00:00.000Z" }),
      goal({ goalId: "g3", resultReady: false, endedAt: "2026-11-03T00:00:00.000Z" }),
    ]
    const picked = latestUnviewedResult(goals, {
      podId: "pod_1",
      viewed: (goalId, revision) => viewed.has(resultViewedKey("pod_1", goalId, revision)),
    })
    assert.equal(picked?.goalId, "g1")
  })

  test("全部查看过 / 没有结果 → null", () => {
    const goals = [goal({ goalId: "g1" })]
    assert.equal(
      latestUnviewedResult(goals, { podId: "pod_1", viewed: () => true }),
      null,
    )
    assert.equal(
      latestUnviewedResult([goal({ goalId: "g1", resultReady: false })], { podId: "pod_1", viewed: () => false }),
      null,
    )
  })
})

describe("revisionHistory（旧版本永不丢）", () => {
  const revisions = [
    {
      revision: 1,
      status: "implementing",
      verdict: null,
      feedback: "第一次方向不对",
      enqueuedAt: "2026-10-31T00:00:00.000Z",
      endedAt: null,
    },
    {
      revision: 2,
      status: "completed",
      verdict: "PASS",
      feedback: null,
      enqueuedAt: "2026-11-01T00:00:00.000Z",
      endedAt: "2026-11-02T00:00:00.000Z",
    },
  ]

  test("新→旧排序，当前版标记，旧版 feedback 保留", () => {
    const rows = revisionHistory(revisions, 2)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].revision, 2)
    assert.equal(rows[0].current, true)
    assert.equal(rows[0].statusLabel, "已完成")
    assert.equal(rows[0].verdictLabel, "已通过")
    assert.equal(rows[1].revision, 1)
    assert.equal(rows[1].current, false)
    assert.equal(rows[1].feedback, "第一次方向不对")
    assert.equal(rows[1].statusLabel, "实施中")
  })

  test("activeRevision 缺省时以最大 revision 为当前版", () => {
    const rows = revisionHistory(revisions, null)
    assert.equal(rows[0].revision, 2)
    assert.equal(rows[0].current, true)
    assert.equal(rows[1].current, false)
  })

  test("空/坏数据 fail-open", () => {
    assert.deepEqual(revisionHistory([], 1), [])
    assert.deepEqual(revisionHistory(null as any, 1), [])
  })

  test("revisionStatusLabel 覆盖全生命周期", () => {
    assert.equal(revisionStatusLabel("discussing"), "讨论中")
    assert.equal(revisionStatusLabel("direction_review"), "方向待裁定")
    assert.equal(revisionStatusLabel("planning"), "规划中")
    assert.equal(revisionStatusLabel("plan_review"), "计划待批准")
    assert.equal(revisionStatusLabel("queued"), "排队中")
    assert.equal(revisionStatusLabel("implementing"), "实施中")
    assert.equal(revisionStatusLabel("reviewing"), "验收中")
    assert.equal(revisionStatusLabel("completed"), "已完成")
    assert.equal(revisionStatusLabel("aborted"), "已中止")
    assert.equal(revisionStatusLabel("discarded"), "已丢弃")
    assert.equal(revisionStatusLabel("legacy_status"), "legacy_status")
    assert.equal(revisionStatusLabel(null), "")
  })
})
