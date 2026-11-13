// F3/F4: `session.updated` has exactly ONE title writer. It writes the entity
// cache (creating an unknown id so a resumed tab that gets an update before its
// bucket fetch keeps the title) and never copies into the open tab list — the
// double write that made the entity cache necessary in the first place.
import { describe, expect, test } from "bun:test"
import { sessionEntities } from "./session-entities"
import { sessionTabTitle } from "./session-title"
import { retitleSessionEntity } from "./session-title-writer"

// A fake workspace tab list: the writer must not need it and must not write it.
const fakeTabs = () => [{ id: "s1", title: "Chat 1" }]

describe("retitleSessionEntity", () => {
  test("patches the entity cache only; the open tab list is untouched", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "Chat 1" })
    const tabs = fakeTabs()

    retitleSessionEntity("s1", "问候")

    expect(sessionEntities.get("s1")?.title).toBe("问候")
    expect(tabs).toEqual([{ id: "s1", title: "Chat 1" }])
    // The label every surface reads picks the entity title up (no tab write).
    expect(sessionTabTitle("s1", tabs[0].title, tabs[0])).toBe("问候")
  })

  test("creates the entity when a resumed tab is retitled before its bucket fetch", () => {
    sessionEntities.reset()

    retitleSessionEntity("resumed", "冒烟: quick eval")

    expect(sessionEntities.get("resumed")).toEqual({ id: "resumed", title: "冒烟: quick eval" })
  })

  test("keeps other entity fields when patching a known session", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "Chat 1", directory: "/p", agent: "build" })

    retitleSessionEntity("s1", "问候")

    expect(sessionEntities.get("s1")).toMatchObject({ title: "问候", directory: "/p", agent: "build" })
  })

  test("a Lead tab still displays the role label after a runtime retitle", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "lead", title: "Lead" })

    retitleSessionEntity("lead", "冒烟: quick eval derivation")

    expect(sessionTabTitle("lead", "Lead", { id: "lead", lead: true })).toBe("Lead")
    expect(sessionTabTitle("lead", "Lead", { id: "lead", metadata: { mafw: { role: "lead" } } })).toBe("Lead")
  })

  test("ignores a blank title (a runtime clear never wipes the label)", () => {
    sessionEntities.reset()
    sessionEntities.upsert({ id: "s1", title: "Chat 1" })

    retitleSessionEntity("s1", "   ")

    expect(sessionEntities.get("s1")?.title).toBe("Chat 1")
    expect(sessionEntities.get("ghost")).toBeUndefined()
    retitleSessionEntity("ghost", "")
    expect(sessionEntities.get("ghost")).toBeUndefined()
  })
})
