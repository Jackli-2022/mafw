// E6-2: workspace.sessionRole derives from the session entity cache; the tab
// object is only a fallback for tabs whose entity has not been upserted yet.
import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { sessionEntities } from "../session-entities"
import { createSessionWorkspace } from "./session-workspace"

describe("workspace.sessionRole (entity cache)", () => {
  test("reads the entity metadata", () => {
    sessionEntities.reset()
    const ws = createSessionWorkspace()
    ws.setSessions([{ id: "s1", title: "Chat 1", userMsgId: "u", assistantMsgId: null, done: false }])
    sessionEntities.upsert({ id: "s1", metadata: { mafw: { role: "tech_lead" } } })
    expect(ws.sessionRole("s1")).toBe("tech_lead")
  })

  test("falls back to the tab identity when the entity is missing", () => {
    sessionEntities.reset()
    const ws = createSessionWorkspace()
    ws.setSessions([{
      id: "s1",
      title: "Builder",
      userMsgId: "u",
      assistantMsgId: null,
      done: false,
      metadata: { mafw: { role: "builder" } },
    }])
    expect(ws.sessionRole("s1")).toBe("builder")
  })

  test("keeps the lead marker of a role tab without entity metadata", () => {
    sessionEntities.reset()
    const ws = createSessionWorkspace()
    ws.setSessions([{ id: "lead", title: "Lead", userMsgId: "u", assistantMsgId: null, done: false, lead: true }])
    sessionEntities.upsert({ id: "lead", title: "Lead" })
    expect(ws.sessionRole("lead")).toBe("lead")
  })

  test("returns undefined for an unknown session", () => {
    sessionEntities.reset()
    expect(createSessionWorkspace().sessionRole("ghost")).toBeUndefined()
  })

  test("reacts to a later entity metadata patch (no tab write)", async () => {
    sessionEntities.reset()
    const ws = createSessionWorkspace()
    ws.setSessions([{ id: "s1", title: "Chat 1", userMsgId: "u", assistantMsgId: null, done: false }])
    const seen: Array<string | undefined> = []
    const dispose = createRoot((dispose) => {
      createEffect(() => { seen.push(ws.sessionRole("s1")) })
      return dispose
    })
    sessionEntities.upsert({ id: "s1", metadata: { mafw: { role: "builder" } } })
    await new Promise(r => setTimeout(r, 0))
    dispose()
    expect(seen.at(-1)).toBe("builder")
  })
})
