import { describe, expect, test } from "bun:test"
import { needsSessionInfoHydration } from "./session-info"

// store.session 的 tab 占位只有 directory "."（openSessionTab/createSession），
// 布局恢复甚至可能没有条目；权威 directory 要从 sessions.get 补齐（2026-10-31）。
describe("会话信息补全判定", () => {
  test("没有条目 → 需要补全（布局恢复的 tab）", () => {
    expect(needsSessionInfoHydration(undefined)).toBe(true)
    expect(needsSessionInfoHydration(null)).toBe(true)
  })

  test('目录是 "." 占位 → 需要补全', () => {
    expect(needsSessionInfoHydration({ directory: "." })).toBe(true)
  })

  test("缺 directory 字段 → 需要补全", () => {
    expect(needsSessionInfoHydration({})).toBe(true)
    expect(needsSessionInfoHydration({ directory: "" })).toBe(true)
  })

  test("已有真实目录 → 不需要重复请求", () => {
    expect(needsSessionInfoHydration({ directory: "C:/work/proj" })).toBe(false)
    expect(needsSessionInfoHydration({ directory: "C:/work/proj-wt-feature" })).toBe(false)
  })
})
