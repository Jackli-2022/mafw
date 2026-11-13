// Tests for sessionStore local patch/remove capabilities (event-driven updates).
// Network layer is stubbed via globalThis.window; each test uses a unique
// projectID bucket and session ids (module-level entity/cache state is shared).
// E6-2: the store keeps ids per project bucket; metadata lives in sessionEntities.
import { describe, expect, test, beforeAll } from "bun:test"
import { sessionStore } from "./session-store"
import { sessionEntities } from "./session-entities"

type SessionInfo = {
  id: string
  directory?: string
  projectID?: string
  title?: string
  metadata?: { mafw?: { role?: string } }
  time?: { created?: number; updated?: number }
  parentID?: string
  agent?: string
}

const stubList = (list: SessionInfo[]) => {
  ;(globalThis as any).window = {
    api: { mafw: { sessions: { list: async () => list } } },
  }
}

const flush = () => new Promise(r => setTimeout(r, 0))

const seed = async (projectID: string, list: SessionInfo[]) => {
  stubList(list)
  sessionStore.sessionsFor(projectID) // triggers fetch
  await flush()
  return sessionStore.sessionsFor(projectID)
}

beforeAll(() => stubList([]))

describe("sessionStore.isLoaded", () => {
  test("distinguishes fetched (including empty) from never-fetched", async () => {
    const pid = "p-loaded-empty"
    expect(sessionStore.isLoaded(pid)).toBe(false)
    await seed(pid, [])
    expect(sessionStore.isLoaded(pid)).toBe(true)
  })
})

describe("sessionStore fetch", () => {
  test("upserts every API session into the entity cache", async () => {
    const pid = "p-fetch-entities"
    await seed(pid, [{ id: "f1", title: "One", directory: "/p", parentID: "parent", agent: "build" }])
    expect(sessionEntities.get("f1")).toMatchObject({
      id: "f1",
      title: "One",
      directory: "/p",
      parentID: "parent",
      agent: "build",
    })
  })

  test("sessionsFor maps the entity cache instead of keeping a list copy", async () => {
    const pid = "p-fetch-single-source"
    await seed(pid, [{ id: "f2", title: "from fetch", time: { updated: 10 } }])
    // Mutating the entity (no sessionStore.patch) must be visible immediately:
    // the bucket only holds the id.
    sessionEntities.patch("f2", { title: "patched entity" })
    expect(sessionStore.sessionsFor(pid).map(s => s.title)).toEqual(["patched entity"])
  })

  test("keeps the last-activity ordering of the API list", async () => {
    const pid = "p-fetch-order"
    const out = await seed(pid, [
      { id: "f3", title: "old", time: { updated: 100 } },
      { id: "f4", title: "new", time: { updated: 200 } },
    ])
    expect(out.map(s => s.id)).toEqual(["f4", "f3"])
  })
})

describe("sessionStore.patch", () => {
  test("updates title of a cached session", async () => {
    const pid = "p-patch-title"
    await seed(pid, [{ id: "pt1", title: "old", time: { updated: 100 } }])
    const found = sessionStore.patch("pt1", { title: "new title" })
    expect(found).toBe(true)
    expect(sessionStore.sessionsFor(pid).find(s => s.id === "pt1")?.title).toBe("new title")
    expect(sessionEntities.get("pt1")?.title).toBe("new title")
  })

  test("re-sorts when time.updated moves the session to front", async () => {
    const pid = "p-patch-sort"
    await seed(pid, [
      { id: "ps1", title: "a", time: { updated: 100 } },
      { id: "ps2", title: "b", time: { updated: 200 } },
    ])
    expect(sessionStore.sessionsFor(pid)[0].id).toBe("ps2")
    sessionStore.patch("ps1", { time: { updated: 300 } })
    expect(sessionStore.sessionsFor(pid)[0].id).toBe("ps1")
  })

  test("re-applies fallback title when patched title is empty", async () => {
    const pid = "p-patch-fallback"
    await seed(pid, [{ id: "pf1", title: "x", time: { updated: 100 } }])
    sessionStore.patch("pf1", { title: "  " })
    expect(sessionStore.sessionsFor(pid)[0].title).toBe("New conversation")
  })

  test("returns false when id is not in any cache bucket", async () => {
    const pid = "p-patch-miss"
    await seed(pid, [{ id: "pm1", title: "x" }])
    expect(sessionStore.patch("nope", { title: "y" })).toBe(false)
  })

  test("only touches buckets that contain the id", async () => {
    const p1 = "p-patch-iso-1"
    const p2 = "p-patch-iso-2"
    await seed(p1, [{ id: "pi1", title: "one" }])
    await seed(p2, [{ id: "pi2", title: "two" }])
    sessionStore.patch("pi1", { title: "changed" })
    expect(sessionStore.sessionsFor(p2)[0].title).toBe("two")
  })
})

describe("sessionStore.remove", () => {
  test("drops the session from its cache bucket", async () => {
    const pid = "p-remove-basic"
    await seed(pid, [
      { id: "r1", title: "a", time: { updated: 100 } },
      { id: "r2", title: "b", time: { updated: 200 } },
    ])
    const found = sessionStore.remove("r1")
    expect(found).toBe(true)
    expect(sessionStore.sessionsFor(pid).map(s => s.id)).toEqual(["r2"])
    expect(sessionEntities.get("r1")).toBeUndefined()
  })

  test("returns false for unknown id", async () => {
    const pid = "p-remove-miss"
    await seed(pid, [{ id: "rm1", title: "a" }])
    expect(sessionStore.remove("ghost")).toBe(false)
  })
})

describe("sessionStore.invalidate", () => {
  test("keeps entities for offline reads while buckets refetch", async () => {
    const pid = "p-invalidate-keep"
    await seed(pid, [{ id: "i1", title: "cached", directory: "/p" }])
    stubList([])
    sessionStore.invalidate(pid)
    await flush()
    expect(sessionStore.sessionsFor(pid)).toEqual([])
    expect(sessionEntities.get("i1")?.directory).toBe("/p")
  })

  test("a full resync reset drops stale entities so buckets cannot resurrect them", async () => {
    const pid = "p-invalidate-reset"
    await seed(pid, [{ id: "ir1", title: "stale" }])
    sessionEntities.reset()
    expect(sessionStore.sessionsFor(pid)).toEqual([])
  })
})
