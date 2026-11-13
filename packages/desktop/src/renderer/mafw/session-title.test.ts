// E6-2: tab labels / ChatPane header read the entity cache; tabs keep their
// title only as a first-frame fallback (persisted `{id,title}` resumes).
import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { sessionEntities } from "./session-entities"
import {
  resolveOpenSessionTitle,
  sessionSnapshotTabs,
  sessionTabTitle,
  sessionTitle,
} from "./session-title"

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

// F1: restore must not overwrite a fresh gateway title with the persisted tab
// snapshot ("Chat 1"). The entity title wins; the caller only seeds it.
describe("resolveOpenSessionTitle", () => {
  test("a fresh entity title beats a stale persisted/caller title", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "问候" })
    const resolved = resolveOpenSessionTitle({
      knownTitle: sessionEntities.get("s1")?.title,
      callerTitle: "Chat 1",
      fallback: "Chat 1",
    })
    expect(resolved).toBe("问候")
    expect(sessionTitle("s1", "Chat 1")).toBe("问候")
  })

  test("an explicit caller title seeds an entity that has none yet", () => {
    sessionEntities.reset()
    expect(resolveOpenSessionTitle({ callerTitle: "我的会话", fallback: "Chat 1" })).toBe("我的会话")
  })

  test("a generated caller title does not replace a real entity title", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "用户改名" })
    expect(resolveOpenSessionTitle({
      knownTitle: sessionEntities.get("s1")?.title,
      callerTitle: "Goal X",
      fallback: "Chat 1",
    })).toBe("用户改名")
  })

  test("generated placeholders never win over a real title, only over each other", () => {
    expect(resolveOpenSessionTitle({ knownTitle: "Chat 3", callerTitle: "Builder · A · rev 1" }))
      .toBe("Builder · A · rev 1")
    expect(resolveOpenSessionTitle({ knownTitle: "Chat 3", callerTitle: "Chat 1" }))
      .toBe("Chat 3")
    expect(resolveOpenSessionTitle({ fallback: "Chat 2" })).toBe("Chat 2")
  })

  test("the Lead role label wins at open time", () => {
    expect(resolveOpenSessionTitle({ lead: true, knownTitle: "冒烟: quick eval", callerTitle: "Chat 1" }))
      .toBe("Lead")
  })
})

// F1: layout snapshots persist the live label, so a persisted resume cannot
// resurrect a stale placeholder after the entity title moved on.
describe("sessionSnapshotTabs", () => {
  test("persists the live entity title over the stale tab fallback", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "问候" })
    expect(sessionSnapshotTabs([{ id: "s1", title: "Chat 1" }])).toEqual([{ id: "s1", title: "问候" }])
  })

  test("persists the role label for the Lead tab", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "lead", title: "冒烟: quick eval derivation" })
    expect(sessionSnapshotTabs([{ id: "lead", title: "Lead", lead: true }])[0].title).toBe("Lead")
  })

  test("falls back to the tab title while the entity is missing", () => {
    sessionEntities.reset()
    expect(sessionSnapshotTabs([{ id: "s1", title: "Chat 1" }])).toEqual([{ id: "s1", title: "Chat 1" }])
  })
})
