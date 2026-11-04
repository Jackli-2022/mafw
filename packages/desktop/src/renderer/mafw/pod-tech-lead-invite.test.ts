// Task 19：Lead 会话里的 Tech Lead 入口（spec 2026-11-02-pod-collaborative-goal-loop）。
//
// 纯逻辑住在这里：邀请卡判定（只有 `discussing` 阶段的 Goal 才提示去和 Tech Lead 讨论）、
// tab 标题（Goal 标题派生，永不含 runtime session id）、可见文案（Manager 已退役 → Lead）。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  TECH_LEAD_INVITE_LABEL,
  createPodStore,
  leadEntryLabel,
  techLeadInvite,
  techLeadTabTitle,
  type PodStoreApi,
} from "./pod-store"

describe("techLeadInvite", () => {
  test("discussing 阶段的 Tech Lead 讨论 Goal 产出邀请", () => {
    assert.deepEqual(techLeadInvite({ stage: { kind: "discussing", role: "tech_lead" } }, "g1"), {
      goalId: "g1",
      label: "与 Tech Lead 讨论",
    })
    assert.equal(TECH_LEAD_INVITE_LABEL, "与 Tech Lead 讨论")
  })

  test("非终态 Goal 各阶段都产出邀请（planning / plan_approval / working / discussing）", () => {
    for (const kind of ["discussing", "planning", "plan_approval", "working"]) {
      assert.deepEqual(techLeadInvite({ stage: { kind, role: "tech_lead" } }, "g1"), {
        goalId: "g1",
        label: "与 Tech Lead 讨论",
      }, `stage=${kind}`)
    }
    // 非 Tech Lead 角色的阶段同样可进讨论（Goal 的主对话面就是 Tech Lead）
    assert.deepEqual(techLeadInvite({ stage: { kind: "working", role: "builder" } }, "g1"), {
      goalId: "g1",
      label: "与 Tech Lead 讨论",
    })
  })

  test("旧 gateway 缺 stage 不误报：非终态仍显示（endedAt 才是终态权威）", () => {
    assert.deepEqual(techLeadInvite({ stage: null }, "g1"), { goalId: "g1", label: "与 Tech Lead 讨论" })
    assert.deepEqual(techLeadInvite({}, "g1"), { goalId: "g1", label: "与 Tech Lead 讨论" })
    assert.equal(techLeadInvite(null, "g1"), null)
    assert.equal(techLeadInvite(undefined, "g1"), null)
  })

  test("终态 Goal（endedAt 非空）不再提示", () => {
    assert.equal(techLeadInvite({ stage: { kind: "discussing", role: "tech_lead" }, endedAt: "2026-11-04T00:00:00.000Z" }, "g1"), null)
    assert.equal(techLeadInvite({ endedAt: "2026-11-04T00:00:00.000Z" }, "g1"), null)
  })

  test("没有 goalId 就不出邀请（防 nullptr tab 标题）", () => {
    assert.equal(techLeadInvite({ stage: { kind: "discussing", role: "tech_lead" } }, ""), null)
  })
})

describe("techLeadTabTitle", () => {
  test("用 Goal 标题派生 tab 标题", () => {
    assert.equal(techLeadTabTitle("Pod loop"), "Tech Lead · Pod loop")
  })

  test("缺标题时用固定占位，不泄漏 runtime id", () => {
    assert.equal(techLeadTabTitle(""), "Tech Lead · 未命名目标")
    assert.equal(techLeadTabTitle("   "), "Tech Lead · 未命名目标")
    assert.equal(techLeadTabTitle(undefined), "Tech Lead · 未命名目标")
    assert.doesNotMatch(techLeadTabTitle("Pod loop"), /ses_|session/i)
  })
})

describe("leadEntryLabel", () => {
  test("用户可见的协调入口只叫 Lead", () => {
    assert.equal(leadEntryLabel(), "Lead")
    assert.notEqual(leadEntryLabel(), "Manager")
  })
})

describe("pod-store techLead", () => {
  const detail = {
    pod: { id: "pod_1", projectDir: "/p", status: "active" },
    members: [],
    goals: [],
    tasks: [],
    sessions: [],
  } as any

  test("按当前 Pod + Goal 调讨论历史接口，把隐藏会话 id 交给调用方（不缓存进 store）", async () => {
    const calls: string[] = []
    const api = {
      lookup: async () => detail,
      cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
      listMessages: async () => ({ items: [] }),
      techLead: async (podID: string, goalID: string) => {
        calls.push(`techLead:${podID}:${goalID}`)
        return { goalId: goalID, revision: 1, sessionID: `ses_${goalID}`, messages: [] }
      },
    } as unknown as PodStoreApi
    const store = createPodStore(api, { timers: { setTimeout: (fn) => { fn(); return 0 }, clearTimeout: () => {} } })
    await store.open("/p")
    const history = await store.techLead("g1")
    assert.deepEqual(calls, ["techLead:pod_1:g1"])
    assert.equal(history.sessionID, "ses_g1")
  })

  test("没有 Pod 时拒绝调用（避免落到错误的项目）", async () => {
    const api = { techLead: async () => { throw new Error("should not be called") } } as unknown as PodStoreApi
    const store = createPodStore(api)
    await assert.rejects(() => store.techLead("g1"), /pod unavailable/)
  })
})
