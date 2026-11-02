// Task 20：计划审阅 = PlanPackage（waves + Goal Eval + Spike 证据 + 版本哈希）。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { renderPlanPackage } from "./plan-render"

const PKG = {
  revision: 2,
  planHash: "abc123def456",
  evalHash: "fed654cba321",
  waves: {
    status: "ready",
    taskType: "feature",
    waves: [
      { id: "w1", title: "地基", tasks: [{ title: "建 Goal 入口", acceptance: ["Lead 能建 Goal"] }], riskNote: "迁移风险" },
    ],
  },
  goalEval: {
    outcome: "用户可以在 Pod 中协作完成 Goal",
    conditions: [
      { id: "g1", statement: "用户可以从 Lead 创建 Goal", required: true, evidence: "goal_created 事件", method: "E2E" },
      { id: "g2", statement: "实施前计划已人工批准", required: false, evidence: "planApproval 记录", method: "单元测试" },
    ],
    failureConditions: ["未经批准就实施"],
    constraints: ["不修改主工作区"],
    nonGoals: ["不做移动端"],
    mapping: { g1: { tasks: ["w1-t1"], probes: ["p1"], artifacts: ["receipt.json"] } },
  },
  probes: [
    {
      id: "p1",
      status: "completed",
      request: { question: "能否从 Lead 直接创建 Goal", hypothesis: "可以" },
      report: {
        conclusion: "supports",
        commands: ["npm test"],
        keyOutput: "创建成功",
        repro: ["1. 在 Lead 会话提交意图"],
        remainingAssumptions: ["A2A 传输未验证"],
        impact: { plan: "保留 w1", goalEval: "g1" },
      },
    },
  ],
}

describe("renderPlanPackage", () => {
  test("渲染 Goal Eval 条件（id: statement）", () => {
    const md = renderPlanPackage(PKG)
    assert.match(md, /Goal Eval/)
    assert.match(md, /g1: 用户可以从 Lead 创建 Goal/)
    assert.match(md, /必需/)
    assert.match(md, /g2: 实施前计划已人工批准/)
    assert.match(md, /可选/)
  })

  test("条件带证据与验证方法", () => {
    const md = renderPlanPackage(PKG)
    assert.match(md, /证据：goal_created 事件/)
    assert.match(md, /验证：E2E/)
    assert.match(md, /失败条件/)
    assert.match(md, /非目标/)
  })

  test("条件 → task/probe/artifact 证据映射", () => {
    const md = renderPlanPackage(PKG)
    assert.match(md, /tasks: w1-t1/)
    assert.match(md, /probes: p1/)
    assert.match(md, /artifacts: receipt\.json/)
  })

  test("Spike 报告卡 + 未验证假设", () => {
    const md = renderPlanPackage(PKG)
    assert.match(md, /Probe p1 · supports/)
    assert.match(md, /能否从 Lead 直接创建 Goal/)
    assert.match(md, /未验证假设/)
    assert.match(md, /A2A 传输未验证/)
    assert.match(md, /关键输出：创建成功/)
  })

  test("绑定版本：revision + Plan/Eval hash", () => {
    const md = renderPlanPackage(PKG)
    assert.match(md, /Revision 2/)
    assert.match(md, /Plan hash: abc123def456/)
    assert.match(md, /Eval hash: fed654cba321/)
  })

  test("计划内容变更 → stale 提示（批准已失效）", () => {
    const md = renderPlanPackage({ ...PKG, stale: true })
    assert.match(md, /已变更|失效/)
  })

  test("waves 照常渲染（旧行为保留）", () => {
    const md = renderPlanPackage(PKG)
    assert.match(md, /Wave w1：地基/)
    assert.match(md, /建 Goal 入口/)
    assert.match(md, /验收：Lead 能建 Goal/)
  })

  test("缺 Goal Eval 时仍渲染计划并显式提示，不抛错", () => {
    const md = renderPlanPackage({ waves: { status: "ready", waves: [{ id: "w1", title: "只有计划", tasks: ["t"] }] } })
    assert.match(md, /Wave w1：只有计划/)
    assert.match(md, /Goal Eval/)
    assert.match(md, /没有可解析/)
  })

  test("非法输入 → 空串（不抛错）", () => {
    assert.equal(renderPlanPackage(null), "")
    assert.equal(renderPlanPackage(undefined), "")
    assert.equal(renderPlanPackage("oops"), "")
    assert.equal(renderPlanPackage({}), "")
  })
})
