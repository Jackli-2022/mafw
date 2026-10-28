// W1 计划审阅：waves.json → Markdown 渲染 + 视图模型（纯函数）。
import { describe, expect, test } from "bun:test"
import { renderPlanMarkdown } from "./plan-render"
import { planReviewViewModel } from "./plan-review-model"

const READY = {
  status: "ready",
  taskType: "feature",
  waves: [
    { id: "w1", title: "地基", tasks: ["t1", "t2"], riskNote: "迁移风险" },
    { id: "w2", title: "收尾", tasks: ["t3"], riskNote: "" },
  ],
}

describe("renderPlanMarkdown", () => {
  test("ready waves → Wave 标题 + 任务列表 + riskNote", () => {
    const md = renderPlanMarkdown(READY)
    expect(md).toContain("## Wave w1：地基")
    expect(md).toContain("- t1")
    expect(md).toContain("> 迁移风险")
    expect(md).toContain("## Wave w2：收尾")
  })
  test("need_clarification → 待澄清问题清单", () => {
    const md = renderPlanMarkdown({ status: "need_clarification", ambiguities: ["范围?", "预算?"] })
    expect(md).toContain("待澄清")
    expect(md).toContain("- 范围?")
    expect(md).toContain("- 预算?")
  })
  test("null / 畸形输入 → 空串（不抛错）", () => {
    expect(renderPlanMarkdown(null)).toBe("")
    expect(renderPlanMarkdown(undefined)).toBe("")
    expect(renderPlanMarkdown("oops")).toBe("")
    expect(renderPlanMarkdown({ status: "ready", waves: [] })).toBe("")
  })
})

describe("planReviewViewModel", () => {
  test("manual + pending → 待批准 + 动作条", () => {
    const vm = planReviewViewModel({
      planReview: "manual",
      planApproval: { status: "pending", round: 1 },
      waves: READY,
      terminal: false,
    })
    expect(vm.status).toBe("pending")
    expect(vm.showActions).toBe(true)
    expect(vm.badge).toContain("待批准")
  })
  test("approved → 已批准无动作条", () => {
    const vm = planReviewViewModel({
      planReview: "manual",
      planApproval: { status: "approved", round: 1 },
      waves: READY,
      terminal: false,
    })
    expect(vm.status).toBe("approved")
    expect(vm.showActions).toBe(false)
  })
  test("rejected → 已驳回无动作条", () => {
    const vm = planReviewViewModel({
      planReview: "manual",
      planApproval: { status: "rejected", round: 1 },
      waves: READY,
      terminal: false,
    })
    expect(vm.status).toBe("rejected")
    expect(vm.showActions).toBe(false)
  })
  test("auto / 缺省 → 只读", () => {
    const vm = planReviewViewModel({ planReview: undefined, planApproval: undefined, waves: READY, terminal: false })
    expect(vm.status).toBe("auto")
    expect(vm.showActions).toBe(false)
  })
  test("终态 → 无动作条（防批准复活）", () => {
    const vm = planReviewViewModel({
      planReview: "manual",
      planApproval: { status: "pending", round: 1 },
      waves: READY,
      terminal: true,
    })
    expect(vm.showActions).toBe(false)
    expect(vm.status).toBe("pending")
  })
  test("waves 缺失 → 空态标记", () => {
    const vm = planReviewViewModel({ planReview: "manual", planApproval: { status: "pending", round: 1 }, waves: null, terminal: false })
    expect(vm.empty).toBe(true)
  })
})
