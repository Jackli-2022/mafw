import { describe, expect, test } from "bun:test"
import type { QueueItem } from "@mafw/sdk"
import { applyQueueSnapshot, extractQueueSnapshot, ingestQueueEvent, queueForSession, queueItemText, replaceQueue } from "./queue-store"

const item = (id: string, at: string, text = id): QueueItem => ({
  id, sessionID: "s1", text, enqueuedAt: at, source: "http",
})

describe("applyQueueSnapshot", () => {
  test("replaces only the target session and sorts by enqueuedAt", () => {
    const prev = { s2: [item("old", "2026-01-01T00:00:00Z")] }
    const next = applyQueueSnapshot(prev, "s1", [
      item("b", "2026-01-02T00:00:00Z"),
      item("a", "2026-01-01T00:00:00Z"),
    ])
    expect(next.s1.map((i) => i.id)).toEqual(["a", "b"])
    expect(next.s2.map((i) => i.id)).toEqual(["old"])
  })

  test("empty snapshot clears that session only", () => {
    const next = applyQueueSnapshot({ s1: [item("a", "2026-01-01T00:00:00Z")], s2: [item("b", "2026-01-01T00:00:00Z")] }, "s1", [])
    expect(next.s1).toEqual([])
    expect(next.s2).toHaveLength(1)
  })

  test("bad enqueuedAt sorts last without throwing", () => {
    const next = applyQueueSnapshot({}, "s1", [
      item("bad", "not-a-date"),
      item("good", "2026-01-01T00:00:00Z"),
    ])
    expect(next.s1.map((i) => i.id)).toEqual(["good", "bad"])
  })
})

describe("extractQueueSnapshot", () => {
  test("reads canonical properties and flat shape", () => {
    const canonical = { properties: { sessionID: "s1", items: [item("a", "2026-01-01T00:00:00Z")] } }
    const flat = { sessionID: "s2", items: [item("b", "2026-01-01T00:00:00Z")] }
    expect(extractQueueSnapshot("fallback", canonical)?.sessionID).toBe("s1")
    expect(extractQueueSnapshot("fallback", flat)?.sessionID).toBe("s2")
  })

  test("returns null for missing/non-array items (do not clear old snapshot)", () => {
    expect(extractQueueSnapshot("s1", { properties: { sessionID: "s1" } })).toBeNull()
    expect(extractQueueSnapshot("s1", { properties: { sessionID: "s1", items: "nope" } })).toBeNull()
    expect(extractQueueSnapshot("s1", null)).toBeNull()
  })

  test("stale session events keep their own key", () => {
    const out = extractQueueSnapshot("active", { properties: { sessionID: "other", items: [] } })
    expect(out?.sessionID).toBe("other")
  })
})

describe("ingestQueueEvent", () => {
  test("replaces the signal and ignores missing items", () => {
    replaceQueue("s1", [item("a", "2026-01-01T00:00:00Z")])
    ingestQueueEvent("s1", { properties: { sessionID: "s1", items: [] } })
    expect(queueForSession("s1")).toEqual([])
    replaceQueue("s1", [item("b", "2026-01-01T00:00:00Z")])
    ingestQueueEvent("s1", { properties: { sessionID: "s1" } })
    expect(queueForSession("s1").map(i => i.id)).toEqual(["b"])
  })
})

describe("queueItemText", () => {
  test("text > parts text > attachment placeholder; truncates", () => {
    expect(queueItemText(item("a", "2026-01-01T00:00:00Z", "hello"), 80)).toBe("hello")
    expect(queueItemText({ ...item("b", "2026-01-01T00:00:00Z"), text: undefined, parts: [{ type: "text", text: "from-part" }] })).toBe("from-part")
    expect(queueItemText({ ...item("c", "2026-01-01T00:00:00Z"), text: undefined, parts: [{ type: "file" }] })).toBe("(附件)")
    expect(queueItemText(item("d", "2026-01-01T00:00:00Z", "x".repeat(120)), 10)).toBe("xxxxxxxxx…")
  })

  test("剥离内联 [语音输入] 标记（Plan 2 D3：队列条不显示标记行）", () => {
    const marked = `你好\n\n[语音输入] 本消息来自用户的实时语音转写。请用简短、口语化的中文回答。`
    expect(queueItemText(item("v1", "2026-01-01T00:00:00Z", marked), 200)).toBe("你好")
    // parts 兜底路径同样剥离
    expect(queueItemText({ ...item("v2", "2026-01-01T00:00:00Z"), text: undefined, parts: [{ type: "text", text: marked }] }, 200)).toBe("你好")
  })
})
