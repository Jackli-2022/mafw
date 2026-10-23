import { beforeEach, describe, expect, test } from "bun:test"
import {
  addPending,
  clearPending,
  hydrateAnnotations,
  pendingFor,
  removePending,
  resetAnnotationStore,
  takeForSend,
} from "./annotation-store"

const calls: Array<{ m: string; args: any[] }> = []
const fakeApi = {
  list: async (sid: string) => {
    calls.push({ m: "list", args: [sid] })
    return sid === "s1"
      ? [
          { id: "a2", sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "c2", createdAt: 2000 },
          { id: "a1", sessionID: "s1", rel: "a.ts", startLine: 2, endLine: 2, code: "y", comment: "c1", createdAt: 1000 },
        ]
      : []
  },
  add: async (a: any) => { calls.push({ m: "add", args: [a] }) },
  remove: async (sid: string, id: string) => { calls.push({ m: "remove", args: [sid, id] }) },
  clear: async (sid: string) => { calls.push({ m: "clear", args: [sid] }) },
}

beforeEach(() => {
  calls.length = 0
  resetAnnotationStore()
  ;(globalThis as any).window = { api: { annotations: fakeApi } }
})

describe("annotation-store", () => {
  test("hydrate 只拉一次并排序", async () => {
    await hydrateAnnotations("s1")
    await hydrateAnnotations("s1")
    expect(calls.filter(c => c.m === "list")).toHaveLength(1)
    expect(pendingFor("s1").map(a => a.id)).toEqual(["a1", "a2"])
  })

  test("addPending：乐观入列 + IPC 落盘", () => {
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 3, endLine: 3, code: "z", comment: "新" })
    const items = pendingFor("s1")
    expect(items).toHaveLength(1)
    expect(items[0].comment).toBe("新")
    expect(items[0].id.length).toBeGreaterThan(0)
    expect(calls.some(c => c.m === "add")).toBe(true)
  })

  test("removePending / clearPending：本地 + IPC", () => {
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "1" })
    const id = pendingFor("s1")[0].id
    removePending("s1", id)
    expect(pendingFor("s1")).toEqual([])
    expect(calls.some(c => c.m === "remove")).toBe(true)
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "1" })
    clearPending("s1")
    expect(pendingFor("s1")).toEqual([])
    expect(calls.some(c => c.m === "clear")).toBe(true)
  })

  test("takeForSend：取走并清空（同一次发送不重复携带）", () => {
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "1" })
    const taken = takeForSend("s1")
    expect(taken).toHaveLength(1)
    expect(pendingFor("s1")).toEqual([])
  })

  test("hydrate 与本地新增竞态：不吞掉水合期间加入的批注", async () => {
    const pending = hydrateAnnotations("s1")
    addPending({ sessionID: "s1", rel: "local.ts", startLine: 1, endLine: 1, code: "z", comment: "水合中" })
    await pending
    const items = pendingFor("s1")
    expect(items.some(a => a.comment === "水合中")).toBe(true)
    expect(items.length).toBe(3) // 磁盘 2 条 + 本地 1 条
  })

  test("会话隔离", async () => {
    await hydrateAnnotations("s1")
    expect(pendingFor("s2")).toEqual([])
  })
})
