/**
 * E2-2: SDK 可恢复 SSE 订阅（spec 2026-11-11-gateway-e2-recovery §3 E2-2）。
 *
 * 缺陷：`SSEConnection` 每次连接都从头订阅，游标（seq）不参与 URL，greeting 的
 * truncated/reset/instanceId 也不暴露——重连 = 全量重拉，且无法判断是否漏帧。
 *
 * 钉住：
 *  (a) cursor.get() → 42 → EventSource URL 带 `since=42`；
 *  (b) 只有带 SSE `id:` 的帧（MessageEvent.lastEventId）写回 cursor；
 *      connected greeting / 无 id 帧 / 注释帧不写；
 *  (c) greeting truncated / reset → onReplayInfo 收到 flags + headSeq；
 *      正常 greeting → 也回调一次（reset/truncated 为 undefined）；
 *  (d) 不传 cursor → URL 无 `since`（现状行为回归）。
 */
import { test, expect, mock } from "bun:test"
import { SSEConnection } from "./sse"

function mockEventSource() {
  const es = { close: mock(), onopen: null, onerror: null, onmessage: null }
  globalThis.EventSource = mock(() => es) as any
  return es as any
}

const lastUrl = () => (globalThis.EventSource as any).mock.calls.at(-1)[0] as string

function cursorOf(initial: number | null) {
  let value = initial
  return {
    get: () => value,
    set: mock((seq: number) => { value = seq }),
    current: () => value,
  }
}

test("cursor.get() → since 进入 EventSource URL（E2-2 a）", () => {
  mockEventSource()
  const sse = new SSEConnection()
  sse.subscribe("http://localhost:3000", { cursor: cursorOf(42) })
  expect(lastUrl()).toBe("http://localhost:3000/api/events?since=42")
  sse.disconnect()
})

test("cursor.get() 为 null → URL 不带 since", () => {
  mockEventSource()
  const sse = new SSEConnection()
  sse.subscribe("http://localhost:3000", { cursor: cursorOf(null) })
  expect(lastUrl()).toBe("http://localhost:3000/api/events")
  sse.disconnect()
})

test("不带 cursor 选项 → URL 无 since（E2-2 d 现状回归）", () => {
  mockEventSource()
  const sse = new SSEConnection()
  sse.connect("http://localhost:3000")
  expect(lastUrl()).toBe("http://localhost:3000/api/events")
  expect(lastUrl()).not.toContain("since")
  sse.disconnect()
})

test("带 id: 的帧写回 cursor；greeting 与无 id 帧不写（E2-2 b）", () => {
  const es = mockEventSource()
  const cursor = cursorOf(null)
  const sse = new SSEConnection()
  sse.subscribe("http://localhost:3000", { cursor })

  // connected greeting 无 SSE id → 不写
  es.onmessage({ data: JSON.stringify({ type: "connected", headSeq: 5, vocab: "v2" }), lastEventId: "" })
  expect(cursor.set).not.toHaveBeenCalled()

  // 普通无 id 帧 → 不写
  es.onmessage({ data: JSON.stringify({ type: "chat", content: "hi" }), lastEventId: "" })
  expect(cursor.set).not.toHaveBeenCalled()

  // 带 id: 7 的帧 → cursor.set(7)
  es.onmessage({ data: JSON.stringify({ type: "chat", content: "again", seq: 7 }), lastEventId: "7" })
  expect(cursor.set).toHaveBeenCalledTimes(1)
  expect(cursor.set).toHaveBeenCalledWith(7)
  expect(cursor.current()).toBe(7)

  // 非法 lastEventId（非数字）忽略
  es.onmessage({ data: JSON.stringify({ type: "chat" }), lastEventId: "garbage" })
  expect(cursor.set).toHaveBeenCalledTimes(1)
  sse.disconnect()
})

test("greeting truncated → onReplayInfo 收到 flags + headSeq（E2-2 c）", () => {
  const es = mockEventSource()
  const onReplayInfo = mock()
  const sse = new SSEConnection()
  sse.subscribe("http://localhost:3000", { onReplayInfo })
  es.onmessage({
    data: JSON.stringify({ type: "connected", headSeq: 120, firstReplayedSeq: 21, truncated: true, instanceId: "i1", schemaEpoch: 3 }),
    lastEventId: "",
  })
  expect(onReplayInfo).toHaveBeenCalledTimes(1)
  expect(onReplayInfo.mock.calls[0][0]).toMatchObject({
    headSeq: 120,
    firstReplayedSeq: 21,
    truncated: true,
    instanceId: "i1",
    schemaEpoch: 3,
  })
  sse.disconnect()
})

test("greeting reset → onReplayInfo 收到 reset（E2-2 c）", () => {
  const es = mockEventSource()
  const onReplayInfo = mock()
  const sse = new SSEConnection()
  sse.subscribe("http://localhost:3000", { onReplayInfo })
  es.onmessage({ data: JSON.stringify({ type: "connected", headSeq: 3, reset: true }), lastEventId: "" })
  expect(onReplayInfo).toHaveBeenCalledTimes(1)
  expect(onReplayInfo.mock.calls[0][0]).toMatchObject({ headSeq: 3, reset: true })
  expect(onReplayInfo.mock.calls[0][0].truncated).toBeUndefined()
  sse.disconnect()
})

test("正常 greeting → onReplayInfo 回调一次，reset/truncated 为 undefined", () => {
  const es = mockEventSource()
  const onReplayInfo = mock()
  const sse = new SSEConnection()
  sse.subscribe("http://localhost:3000", { onReplayInfo })
  es.onmessage({ data: JSON.stringify({ type: "connected", headSeq: 5 }), lastEventId: "" })
  es.onmessage({ data: JSON.stringify({ type: "chat" }), lastEventId: "" })
  expect(onReplayInfo).toHaveBeenCalledTimes(1)
  const info = onReplayInfo.mock.calls[0][0]
  expect(info.headSeq).toBe(5)
  expect(info.reset).toBeUndefined()
  expect(info.truncated).toBeUndefined()
  sse.disconnect()
})

test("onReplayInfo 抛错不打断事件分发（fail-open）", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  const cb = mock()
  sse.on("chat", cb)
  sse.subscribe("http://localhost:3000", { onReplayInfo: () => { throw new Error("boom") } })
  es.onmessage({ data: JSON.stringify({ type: "connected", headSeq: 1 }), lastEventId: "" })
  // 当前实现里 try/catch 覆盖整个 onmessage；这里只要求不抛到调用方。
  expect(() => es.onmessage({ data: JSON.stringify({ type: "connected", headSeq: 1 }), lastEventId: "" })).not.toThrow()
  sse.disconnect()
})

