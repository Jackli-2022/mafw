// 班底焦点行（2026-11-04，spec 2026-11-04-techlead-goal-entry-design §3.3）：
// 行 = 目录 + 当前焦点；Tech Lead 恒走 techlead 通路（ensure 讨论会话），
// 其余成员维持 memberOpenTarget（live 会话 / 已结束 transcript）。
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { memberFocus, techLeadEntryMode } from "./pod-model"

const base = {
  pod: { id: "pod_1", projectDir: "/p", status: "active" },
  members: [
    { id: "m_l", role: "lead", displayName: "Lead", agentName: "lead", status: "working" },
    { id: "m_t", role: "tech_lead", displayName: "Tech Lead", agentName: "mafw-tech-lead", status: "working" },
    { id: "m_b", role: "builder", displayName: "Builder", agentName: "mafw-execute", status: "working" },
    { id: "m_r", role: "reviewer", displayName: "Reviewer", agentName: "mafw-review", status: "available" },
  ],
  goals: [
    { goalId: "g1", title: "导出限流", endedAt: null, activeRevision: 1 },
  ],
  sessions: [] as any[],
  tasks: [],
} as any

describe("memberFocus", () => {
  test("tech_lead 有 live 讨论会话 → 走 techlead 通路，焦点含「讨论「Goal 标题」」", () => {
    const detail = {
      ...base,
      sessions: [
        { memberId: "m_t", sessionId: "ses_tl", goalId: "g1", node: "discussion", endedAt: null, createdAt: "2026-11-04T01:00:00.000Z" },
      ],
    } as any
    const focus = memberFocus(detail, "m_t")
    assert.deepEqual(focus.target, { kind: "techlead", goalId: "g1" })
    assert.match(String(focus.focusText), /讨论「导出限流」/)
  })

  test("tech_lead 无 live 会话 + 存在非终态 Goal → techlead 通路指向该 Goal（ensure 恢复）", () => {
    const focus = memberFocus({ ...base, sessions: [] } as any, "m_t")
    assert.deepEqual(focus.target, { kind: "techlead", goalId: "g1" })
    assert.match(String(focus.focusText), /讨论「导出限流」/)
  })

  test("tech_lead 全部会话已结束（Goal 也终态）→ 回退 transcript", () => {
    const detail = {
      ...base,
      goals: [{ goalId: "g1", title: "导出限流", endedAt: "2026-11-03T00:00:00.000Z", activeRevision: 1 }],
      sessions: [
        { memberId: "m_t", sessionId: "ses_tl", goalId: "g1", node: "discussion", endedAt: "2026-11-03T01:00:00.000Z", transcriptRef: "snap_1", createdAt: "2026-11-03T00:00:00.000Z" },
      ],
    } as any
    const focus = memberFocus(detail, "m_t")
    assert.deepEqual(focus.target, { kind: "transcript", sessionId: "ses_tl" })
  })

  test("lead → ensure 通路（sessionId 空串），无 live 会话时焦点为「协调中」", () => {
    const focus = memberFocus({ ...base, sessions: [] } as any, "m_l")
    assert.deepEqual(focus.target, { kind: "session", sessionId: "" })
    assert.equal(focus.focusText, "协调中")
  })

  test("builder live execute 会话 → 打开该会话，焦点含「实施」", () => {
    const detail = {
      ...base,
      sessions: [
        { memberId: "m_b", sessionId: "ses_b", goalId: "g1", node: "execute", endedAt: null, createdAt: "2026-11-04T02:00:00.000Z" },
      ],
    } as any
    const focus = memberFocus(detail, "m_b")
    assert.deepEqual(focus.target, { kind: "session", sessionId: "ses_b" })
    assert.match(String(focus.focusText), /实施「导出限流」/)
  })

  test("成员无任何会话 → target null + focusText null（UI 显示待命）", () => {
    const focus = memberFocus({ ...base, sessions: [] } as any, "m_r")
    assert.deepEqual(focus, { focusText: null, target: null })
  })

  test("tech_lead 的 live 会话绑在已终态 Goal 上时，改指非终态 Goal（ensure 对终态会 409）", () => {
    const detail = {
      ...base,
      goals: [
        { goalId: "g_old", title: "旧目标", endedAt: "2026-11-03T00:00:00.000Z", activeRevision: 1 },
        { goalId: "g_new", title: "导出限流", endedAt: null, activeRevision: 1 },
      ],
      sessions: [
        { memberId: "m_t", sessionId: "ses_old", goalId: "g_old", node: "discussion", endedAt: null, createdAt: "2026-11-04T03:00:00.000Z" },
      ],
    } as any
    const focus = memberFocus(detail, "m_t")
    assert.deepEqual(focus.target, { kind: "techlead", goalId: "g_new" })
  })

  test("detail 缺失 / 未知成员 → 安全空值", () => {
    assert.deepEqual(memberFocus(null, "m_t"), { focusText: null, target: null })
    assert.deepEqual(memberFocus(base, "m_missing"), { focusText: null, target: null })
  })
})

// 入口 B 的分支决策（spec §3.2 / 复审 C1）：终态只能看归档 transcript——
// GET tech-lead 对终态 revision 返回 409，绝不能走 ensure 路由。
describe("techLeadEntryMode", () => {
  test("非终态走 ensure 讨论；终态降级 transcript", () => {
    assert.equal(techLeadEntryMode({ endedAt: null }), "discuss")
    assert.equal(techLeadEntryMode({}), "discuss")
    assert.equal(techLeadEntryMode({ endedAt: "2026-11-04T00:00:00.000Z" }), "transcript")
    assert.equal(techLeadEntryMode(null), null)
    assert.equal(techLeadEntryMode(undefined), null)
  })
})
