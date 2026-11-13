// E6-2: the ONE metadata cache for desktop sessions. session-store only keeps
// project buckets of ids; title/directory/projectID/metadata/time/agent/parentID
// live here so session.updated never has to be copied into tabs.
import { describe, expect, test } from "bun:test"
import { createEffect, createRoot } from "solid-js"
import { sessionEntities } from "./session-entities"

const fresh = () => sessionEntities.reset()

describe("sessionEntities.upsert", () => {
  test("stores a new entity and get returns it", () => {
    fresh()
    sessionEntities.upsert({ id: "e1", title: "One", directory: "/p" })
    expect(sessionEntities.get("e1")).toEqual({ id: "e1", title: "One", directory: "/p" })
    expect(sessionEntities.get("nope")).toBeUndefined()
  })

  test("merges into an existing entity and keeps fields it did not provide", () => {
    fresh()
    sessionEntities.upsert({ id: "e1", title: "One", directory: "/p", time: { created: 1 } })
    sessionEntities.upsert({ id: "e1", title: "Renamed" })
    expect(sessionEntities.get("e1")).toEqual({
      id: "e1",
      title: "Renamed",
      directory: "/p",
      time: { created: 1 },
    })
  })

  test("ignores undefined fields and never drops the id", () => {
    fresh()
    sessionEntities.upsert({ id: "e1", title: "One" })
    sessionEntities.upsert({ id: "e1", title: undefined, parentID: "parent" })
    expect(sessionEntities.get("e1")).toEqual({ id: "e1", title: "One", parentID: "parent" })
  })
})

describe("sessionEntities.patch", () => {
  test("merges a partial and reports whether the entity existed", () => {
    fresh()
    sessionEntities.upsert({ id: "e1", title: "One", directory: "/p" })
    expect(sessionEntities.patch("e1", { title: "Two" })).toBe(true)
    expect(sessionEntities.get("e1")).toEqual({ id: "e1", title: "Two", directory: "/p" })
    expect(sessionEntities.patch("missing", { title: "x" })).toBe(false)
  })
})

describe("sessionEntities.remove", () => {
  test("drops the entity and reports whether it existed", () => {
    fresh()
    sessionEntities.upsert({ id: "e1" })
    expect(sessionEntities.remove("e1")).toBe(true)
    expect(sessionEntities.get("e1")).toBeUndefined()
    expect(sessionEntities.remove("e1")).toBe(false)
  })
})

describe("sessionEntities.version", () => {
  test("bumps on upsert/patch/remove so reactive readers rerun", async () => {
    fresh()
    const runs: number[] = []
    const dispose = createRoot((dispose) => {
      createEffect(() => { runs.push(sessionEntities.version()) })
      return dispose
    })
    sessionEntities.upsert({ id: "e1" })
    sessionEntities.patch("e1", { title: "x" })
    sessionEntities.remove("e1")
    await new Promise(r => setTimeout(r, 0))
    dispose()
    expect(runs.length).toBe(4)
  })
})

describe("sessionEntities.reset", () => {
  test("clears every entity so stale rows cannot be resurrected", () => {
    fresh()
    sessionEntities.upsert({ id: "e1", title: "One" })
    sessionEntities.upsert({ id: "e2", title: "Two" })
    sessionEntities.reset()
    expect(sessionEntities.get("e1")).toBeUndefined()
    expect(sessionEntities.get("e2")).toBeUndefined()
  })
})
