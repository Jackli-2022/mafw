import { test, expect, mock, spyOn } from "bun:test"
import { SSEConnection } from "./sse"

function mockEventSource() {
  const es = { close: mock(), onopen: null, onerror: null, onmessage: null }
  globalThis.EventSource = mock(() => es) as any
  return es as any
}

test("SSEConnection.connect() creates EventSource with correct URL", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connect("http://localhost:3000")
  expect(globalThis.EventSource).toHaveBeenCalledWith("http://localhost:3000/api/events")
  sse.disconnect()
})

test("SSEConnection.connectToSession() creates EventSource with sessionID", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connectToSession("http://localhost:3000", "session-abc")
  expect(globalThis.EventSource).toHaveBeenCalledWith("http://localhost:3000/api/events?sessionID=session-abc")
  sse.disconnect()
})

test("SSEConnection.connectToSession() encodes sessionID", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connectToSession("http://localhost:3000", "session with spaces/&?")
  const url = (globalThis.EventSource as any).mock.calls[0][0] as string
  expect(url).toContain(encodeURIComponent("session with spaces/&?"))
  sse.disconnect()
})

test("SSEConnection.disconnect() closes EventSource and clears state", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connect("http://localhost:3000")
  expect(sse.connected).toBe(false)
  es.onopen()
  expect(sse.connected).toBe(true)
  sse.disconnect()
  expect(es.close).toHaveBeenCalled()
  expect(sse.connected).toBe(false)
})

test("SSEConnection.connect() disconnects before connecting again", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connect("http://localhost:3000")
  sse.connect("http://localhost:3000")
  expect(es.close).toHaveBeenCalled()
  sse.disconnect()
})

test("SSEConnection.on() registers listener and returns unsubscribe", () => {
  const sse = new SSEConnection()
  const cb = mock()
  const unsub = sse.on("test-event", cb)
  sse.emit({ type: "test-event", data: 42 })
  expect(cb).toHaveBeenCalledWith({ type: "test-event", data: 42 })
  unsub()
  cb.mockReset()
  sse.emit({ type: "test-event", data: 99 })
  expect(cb).not.toHaveBeenCalled()
})

test("SSEConnection routes events by type", () => {
  const sse = new SSEConnection()
  const onAlpha = mock()
  const onBeta = mock()
  sse.on("alpha", onAlpha)
  sse.on("beta", onBeta)
  sse.emit({ type: "alpha", value: 1 })
  expect(onAlpha).toHaveBeenCalledWith({ type: "alpha", value: 1 })
  expect(onBeta).not.toHaveBeenCalled()
})

test("SSEConnection wildcard '*' receives all events", () => {
  const sse = new SSEConnection()
  const wild = mock()
  sse.on("*", wild)
  sse.emit({ type: "ping" })
  sse.emit({ type: "pong" })
  expect(wild).toHaveBeenCalledTimes(2)
})

test("SSEConnection emits to type-specific AND wildcard listeners", () => {
  const sse = new SSEConnection()
  const specific = mock()
  const wild = mock()
  sse.on("delta", specific)
  sse.on("*", wild)
  sse.emit({ type: "delta", content: "hello" })
  expect(specific).toHaveBeenCalledWith({ type: "delta", content: "hello" })
  expect(wild).toHaveBeenCalledWith({ type: "delta", content: "hello" })
})

test("SSEConnection.emit() falls back to 'message' type when no type field", () => {
  const sse = new SSEConnection()
  const cb = mock()
  sse.on("message", cb)
  sse.emit({ data: "raw" })
  expect(cb).toHaveBeenCalledWith({ data: "raw" })
})

test("SSE connection sets _connected=true on open", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connect("http://localhost:3000")
  expect(sse.connected).toBe(false)
  es.onopen()
  expect(sse.connected).toBe(true)
  sse.disconnect()
})

test("SSE connection sets _connected=false on error", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  sse.connect("http://localhost:3000")
  es.onopen()
  es.onerror()
  expect(sse.connected).toBe(false)
  sse.disconnect()
})

test("SSEConnection.onmessage parses JSON and dispatches by type", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  const cb = mock()
  sse.on("chat", cb)
  sse.connect("http://localhost:3000")
  es.onmessage({ data: JSON.stringify({ type: "chat", content: "hi" }) })
  expect(cb).toHaveBeenCalledWith({ type: "chat", content: "hi" })
  sse.disconnect()
})

test("SSEConnection.onmessage ignores invalid JSON", () => {
  const es = mockEventSource()
  const sse = new SSEConnection()
  const cb = mock()
  sse.on("*", cb)
  sse.connect("http://localhost:3000")
  es.onmessage({ data: "not json" })
  expect(cb).not.toHaveBeenCalled()
  sse.disconnect()
})
