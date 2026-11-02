// Task 2 review I-1（spec 2026-11-02-pod-collaborative-goal-loop §3.1）：Lead 替换 Manager
// 后桌面的协调会话语义。
//
// 网关把协调会话的 metadata.role 从 manager 改成 lead，并且把它从 /api/sessions 列表隐藏。
// 桌面因此必须：① 把 lead 与历史 manager 视为同一角色；② 在历史列表里找不到隐藏的 Lead
// 时，仍能按 kv 权威 id 打开它（否则"新建 Goal"/"新话题"/agent 锁会静默失效）。
import { describe, expect, test } from "bun:test"
import {
  isLeadSessionRole,
  leadTabMetadata,
  resolveLeadSession,
  tabSessionRole,
} from "./manager-session"

describe("isLeadSessionRole", () => {
  test("lead 是协调会话的现行角色", () => {
    expect(isLeadSessionRole("lead")).toBe(true)
  })

  test("manager 是历史值，与 lead 同义（旧会话/旧 tab/旧布局）", () => {
    expect(isLeadSessionRole("manager")).toBe(true)
  })

  test("其它角色和空值不是协调会话", () => {
    expect(isLeadSessionRole(undefined)).toBe(false)
    expect(isLeadSessionRole(null)).toBe(false)
    expect(isLeadSessionRole("")).toBe(false)
    expect(isLeadSessionRole("build")).toBe(false)
    expect(isLeadSessionRole("manager-archived")).toBe(false)
  })
})

describe("tabSessionRole", () => {
  test("metadata 角色优先", () => {
    expect(tabSessionRole({ metadata: { mafw: { role: "lead" } } })).toBe("lead")
    expect(tabSessionRole({ metadata: { mafw: { role: "manager" } }, manager: true })).toBe("manager")
  })

  test("只有 manager 标记（旧调用路径 / 恢复的布局）时按 lead 处理", () => {
    expect(isLeadSessionRole(tabSessionRole({ manager: true }))).toBe(true)
  })

  test("普通 tab 没有角色", () => {
    expect(tabSessionRole({})).toBeUndefined()
    expect(tabSessionRole(undefined)).toBeUndefined()
    expect(tabSessionRole({ manager: false })).toBeUndefined()
  })
})

describe("resolveLeadSession", () => {
  test("历史列表里有该会话时沿用它的标题", () => {
    const out = resolveLeadSession({
      managerSessionId: "ses_lead",
      historySessions: [{ id: "ses_lead", title: "项目 Lead" }, { id: "ses_user", title: "chat" }],
    })
    expect(out).toMatchObject({ id: "ses_lead", title: "项目 Lead", manager: true })
    expect(out?.metadata).toEqual({ mafw: { role: "lead" } })
  })

  test("隐藏的 Lead 不在历史列表里时，仍按 kv 权威 id 打开（回归：新建 Goal 曾报「未找到 Manager 会话」）", () => {
    const out = resolveLeadSession({
      managerSessionId: "ses_hidden_lead",
      historySessions: [{ id: "ses_user", title: "chat" }],
    })
    expect(out).toMatchObject({ id: "ses_hidden_lead", title: "Lead", manager: true })
    expect(out?.metadata).toEqual({ mafw: { role: "lead" } })
  })

  test("kv 不可用时回退到历史 metadata 里的协调会话（manager 旧值也算）", () => {
    const legacy = resolveLeadSession({
      managerSessionId: null,
      historySessions: [{ id: "ses_old", title: "Manager", metadata: { mafw: { role: "manager" } } }],
    })
    expect(legacy).toMatchObject({ id: "ses_old", title: "Manager", manager: true })

    const lead = resolveLeadSession({
      managerSessionId: null,
      historySessions: [{ id: "ses_new", metadata: { mafw: { role: "lead" } } }],
    })
    expect(lead).toMatchObject({ id: "ses_new", title: "Lead", manager: true })
  })

  test("完全没有协调会话时返回 null（调用方跳 Goals 页）", () => {
    expect(resolveLeadSession({ managerSessionId: null, historySessions: [{ id: "u1", title: "chat" }] })).toBeNull()
    expect(resolveLeadSession({})).toBeNull()
  })

  test("Lead tab metadata 每次是新对象（避免共享可变引用）", () => {
    expect(leadTabMetadata()).toEqual({ mafw: { role: "lead" } })
    expect(leadTabMetadata()).not.toBe(leadTabMetadata())
  })
})
