// Tests for sessionStore local patch/remove capabilities (event-driven updates).
// Network layer is stubbed via globalThis.window; each test uses a unique
// projectID bucket for isolation (module-level cache is shared).
import { describe, expect, test, beforeAll } from "bun:test"
import { sessionStore } from "./session-store"

type SessionInfo = {
  id: string
  directory?: string
  projectID?: string
  title?: string
  metadata?: { mafw?: { role?: string } }
  time?: { created?: number; updated?: number }
  parentID?: string
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

describe("sessionStore.patch", () => {
  test("updates title of a cached session", async () => {
    const pid = "p-patch-title"
    await seed(pid, [{ id: "s1", title: "old", time: { updated: 100 } }])
    const found = sessionStore.patch("s1", { title: "new title" })
    expect(found).toBe(true)
    expect(sessionStore.sessionsFor(pid).find(s => s.id === "s1")?.title).toBe("new title")
  })

  test("re-sorts when time.updated moves the session to front", async () => {
    const pid = "p-patch-sort"
    await seed(pid, [
      { id: "s1", title: "a", time: { updated: 100 } },
      { id: "s2", title: "b", time: { updated: 200 } },
    ])
    expect(sessionStore.sessionsFor(pid)[0].id).toBe("s2")
    sessionStore.patch("s1", { time: { updated: 300 } })
    expect(sessionStore.sessionsFor(pid)[0].id).toBe("s1")
  })

  test("re-applies fallback title when patched title is empty", async () => {
    const pid = "p-patch-fallback"
    await seed(pid, [{ id: "s1", title: "x", time: { updated: 100 } }])
    sessionStore.patch("s1", { title: "  " })
    expect(sessionStore.sessionsFor(pid)[0].title).toBe("New conversation")
  })

  test("returns false when id is not in any cache bucket", async () => {
    const pid = "p-patch-miss"
    await seed(pid, [{ id: "s1", title: "x" }])
    expect(sessionStore.patch("nope", { title: "y" })).toBe(false)
  })

  test("only touches buckets that contain the id", async () => {
    const p1 = "p-patch-iso-1"
    const p2 = "p-patch-iso-2"
    await seed(p1, [{ id: "s1", title: "one" }])
    await seed(p2, [{ id: "s2", title: "two" }])
    sessionStore.patch("s1", { title: "changed" })
    expect(sessionStore.sessionsFor(p2)[0].title).toBe("two")
  })
})

describe("sessionStore.remove", () => {
  test("drops the session from its cache bucket", async () => {
    const pid = "p-remove-basic"
    await seed(pid, [
      { id: "s1", title: "a", time: { updated: 100 } },
      { id: "s2", title: "b", time: { updated: 200 } },
    ])
    const found = sessionStore.remove("s1")
    expect(found).toBe(true)
    expect(sessionStore.sessionsFor(pid).map(s => s.id)).toEqual(["s2"])
  })

  test("returns false for unknown id", async () => {
    const pid = "p-remove-miss"
    await seed(pid, [{ id: "s1", title: "a" }])
    expect(sessionStore.remove("ghost")).toBe(false)
  })
})
