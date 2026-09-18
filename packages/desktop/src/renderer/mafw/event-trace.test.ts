// Tests for the SSE event trace ring backing the dev event inspector.
import { test, expect, beforeEach } from "bun:test"
import { traceEvent, getTrace, clearTrace } from "./event-trace"

beforeEach(() => clearTrace())

test("records entries newest-first with branch label", () => {
  traceEvent({ type: "session.idle", sessionID: "s1" }, "chat:stream")
  traceEvent({ type: "permission.asked", sessionID: "s1" }, "card:permission")
  const t = getTrace()
  expect(t.length).toBe(2)
  expect(t[0].type).toBe("permission.asked")
  expect(t[0].branch).toBe("card:permission")
  expect(t[1].branch).toBe("chat:stream")
  expect(t[1].sessionID).toBe("s1")
})

test("ring buffer caps at 100 entries", () => {
  for (let i = 0; i < 130; i++) traceEvent({ type: "message.part.delta" }, "chat:delta")
  expect(getTrace().length).toBe(100)
})

test("malformed events are recorded not thrown", () => {
  traceEvent({}, "miss")
  traceEvent(null as any, "miss")
  expect(getTrace().length).toBe(2)
  expect(getTrace()[1].type).toBe("(unknown)")
})
