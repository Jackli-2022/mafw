import { describe, expect, test } from "bun:test"
import { needsSessionInfoHydration, sessionInfoEntityFields } from "./session-info"

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

// F5：会话信息补全同时把权威元数据写进 entity 缓存（store.session 仍保留给
// tab 本地展示）。title 不在此列——标题有独立写入口，水合不得覆盖用户改名。
describe("sessionInfoEntityFields", () => {
  test("copies directory/projectID/agent/parentID/time for the entity cache", () => {
    expect(sessionInfoEntityFields({
      id: "s1",
      title: "问候",
      directory: "C:/work/proj",
      projectID: "proj",
      agent: "build",
      parentID: "parent",
      time: { created: 1, updated: 2 },
    })).toEqual({
      id: "s1",
      directory: "C:/work/proj",
      projectID: "proj",
      agent: "build",
      parentID: "parent",
      time: { created: 1, updated: 2 },
    })
  })

  test("never carries the title (a later gateway read must not clobber a rename)", () => {
    expect(sessionInfoEntityFields({ id: "s1", title: "问候" })).toEqual({ id: "s1" })
  })

  test("null when the payload has no id", () => {
    expect(sessionInfoEntityFields(null)).toBeNull()
    expect(sessionInfoEntityFields({ title: "x" })).toBeNull()
  })
})
