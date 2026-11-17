import { beforeEach, describe, expect, test } from "bun:test"
import {
  addPending,
  annotationsByIDs,
  clearPending,
  draftsFor,
  hydrateAnnotations,
  hydrateAnnotationsByIDs,
  patchPending,
  pendingFor,
  removePending,
  resetAnnotationStore,
  sendableFor,
  setAnnotationHeld,
  takeForSend,
  takeForSendById,
} from "./annotation-store"

const calls: Array<{ m: string; args: any[] }> = []
const remote: any[] = []
const fakeApi = {
  list: async (sid: string) => {
    calls.push({ m: "list", args: [sid] })
    if (sid === "draft:project:C:/repo") {
      return [{ id: "draft-1", sessionID: sid, rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "draft", createdAt: 1 }]
    }
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
  setHeld: async (sid: string, id: string, held: boolean) => { calls.push({ m: "setHeld", args: [sid, id, held] }) },
  patch: async (sid: string, id: string, patch: any) => { calls.push({ m: "patch", args: [sid, id, patch] }) },
  findByIds: async (ids: readonly string[]) => {
    calls.push({ m: "findByIds", args: [ids] })
    return remote.filter((a) => ids.includes(a.id))
  },
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

  test("takeForSendById：只取快照，落库期间新增的留给下一条", () => {
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "1" })
    const first = pendingFor("s1")[0]
    addPending({ sessionID: "s1", rel: "b.ts", startLine: 2, endLine: 2, code: "y", comment: "2" })
    const taken = takeForSendById("s1", [first.id])
    expect(taken.map(a => a.id)).toEqual([first.id])
    expect(pendingFor("s1").map(a => a.comment)).toEqual(["2"])
  })

  test("held：留在 pending，但不随下一条消息发送", () => {
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "保留" })
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 2, endLine: 2, code: "y", comment: "发送" })
    const [held, send] = pendingFor("s1")
    setAnnotationHeld("s1", held.id, true)
    expect(pendingFor("s1").map(a => a.id)).toEqual([held.id, send.id])
    expect(sendableFor("s1").map(a => a.id)).toEqual([send.id])
    expect(calls.some(c => c.m === "setHeld" && c.args[1] === held.id && c.args[2] === true)).toBe(true)

    const taken = takeForSend("s1")
    expect(taken.map(a => a.id)).toEqual([send.id])
    expect(pendingFor("s1").map(a => a.id)).toEqual([held.id])
  })

  test("takeForSendById 不取 held 批注", () => {
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "保留" })
    addPending({ sessionID: "s1", rel: "a.ts", startLine: 2, endLine: 2, code: "y", comment: "发送" })
    const [held, send] = pendingFor("s1")
    setAnnotationHeld("s1", held.id, true)
    const taken = takeForSendById("s1", [held.id, send.id])
    expect(taken.map(a => a.id)).toEqual([send.id])
    expect(pendingFor("s1").map(a => a.id)).toEqual([held.id])
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

  test("discussed and delegated drafts are no longer sendable", () => {
    addPending({ sessionID: "s1", scopeKey: "project:C:/r", rel: "a.ts", startLine: 1, endLine: 1, code: "x", comment: "a" })
    const id = pendingFor("s1")[0].id
    patchPending("s1", id, { discussedAt: 10 })
    expect(sendableFor("s1")).toEqual([])
    expect(draftsFor("s1").map((a) => a.id)).toEqual([id])
    expect(annotationsByIDs([id])[0].discussedAt).toBe(10)
    expect(calls.some((call) => call.m === "patch" && call.args[1] === id)).toBe(true)

    patchPending("s1", id, { discussedAt: undefined, delegatedAt: 20, reviewItemIDs: ["review_1"] })
    expect(sendableFor("s1")).toEqual([])
  })

  test("hydrateAnnotationsByIDs loads refs across session buckets", async () => {
    remote.push({
      id: "remote-1", sessionID: "s2", rel: "b.ts", startLine: 1, endLine: 1,
      code: "y", comment: "remote", createdAt: 3, discussedAt: 4,
    })
    await hydrateAnnotationsByIDs(["remote-1"])
    expect(annotationsByIDs(["remote-1"])[0]).toMatchObject({ sessionID: "s2", discussedAt: 4 })
    expect(pendingFor("s2").map((a) => a.id)).toEqual(["remote-1"])
  })

  test("no-session draft owner hydrates after restart", async () => {
    await hydrateAnnotations("draft:project:C:/repo")
    expect(pendingFor("draft:project:C:/repo").map((a) => a.id)).toEqual(["draft-1"])
  })
})

describe("region 批注 imageDataUrl（仅内存，不落盘）", () => {
  test("addPending：内存保留截图，IPC 载荷剥离", () => {
    addPending({
      sessionID: "s1",
      rel: "a.png",
      startLine: 1,
      endLine: 1,
      code: "",
      comment: "改这里",
      anchor: { kind: "region", x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      imageDataUrl: "data:image/png;base64,AAAA",
    })
    const item = pendingFor("s1")[0]
    expect(item.imageDataUrl).toBe("data:image/png;base64,AAAA")
    const persisted = calls.find(c => c.m === "add")!.args[0]
    expect(persisted.imageDataUrl).toBeUndefined()
    expect(persisted.anchor.kind).toBe("region")
  })
})
