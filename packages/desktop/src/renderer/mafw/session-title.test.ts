// E6-2: tab labels / ChatPane header read the entity cache; tabs keep their
// title only as a first-frame fallback (persisted `{id,title}` resumes).
import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { sessionEntities } from "./session-entities"
import { sessionTabTitle, sessionTitle } from "./session-title"

describe("sessionTitle", () => {
  test("reads the entity cache", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "t1", title: "Entity title" })
    expect(sessionTitle("t1", "tab fallback")).toBe("Entity title")
  })

  test("falls back to the tab title when the entity is missing", () => {
    sessionEntities.reset()
    expect(sessionTitle("t1", "tab fallback")).toBe("tab fallback")
  })

  test("falls back when the entity title is blank, keeping the raw empty value", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "t1", title: "   " })
    expect(sessionTitle("t1", "tab fallback")).toBe("tab fallback")
    expect(sessionTitle("t1")).toBe("")
  })

  test("a session.updated entity patch reaches reactive label readers (no tab write)", async () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "t1", title: "Chat 3" })
    const seen: string[] = []
    const dispose = createRoot((dispose) => {
      createEffect(() => { seen.push(sessionTabTitle("t1", "Chat 3", { id: "t1", title: "Chat 3" })) })
      return dispose
    })
    sessionEntities.patch("t1", { title: "问候" })
    await new Promise(r => setTimeout(r, 0))
    dispose()
    expect(seen.at(-1)).toBe("问候")
  })
})

describe("sessionTabTitle", () => {
  test("role-named tabs keep the role label even after a runtime retitle", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "lead", title: "冒烟: quick eval derivation" })
    expect(sessionTabTitle("lead", "Lead", { id: "lead", lead: true })).toBe("Lead")
    expect(sessionTabTitle("lead", "Lead", { id: "lead", metadata: { mafw: { role: "lead" } } })).toBe("Lead")
  })

  test("ordinary tabs follow the entity title", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "Builder · 修复登录 · rev 1" })
    expect(sessionTabTitle("s1", "Chat 3", { id: "s1", title: "Chat 3" })).toBe("Builder · 修复登录 · rev 1")
  })

  test("missing entity falls back to the tab title", () => {
    sessionEntities.reset()
    expect(sessionTabTitle("s1", "Chat 3", { id: "s1", title: "Chat 3" })).toBe("Chat 3")
  })
})
