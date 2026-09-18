import { test, expect } from "bun:test"
import {
  RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES,
  assertNever, type GatewayEvent,
} from "./events"

test("runtime event list has no duplicates", () => {
  expect(new Set(RUNTIME_EVENT_TYPES).size).toBe(RUNTIME_EVENT_TYPES.length)
  expect(RUNTIME_EVENT_TYPES.length).toBe(25)
})

test("flat event list has no duplicates", () => {
  expect(new Set(FLAT_EVENT_TYPES).size).toBe(FLAT_EVENT_TYPES.length)
  expect(FLAT_EVENT_TYPES.length).toBe(13)
})

test("assertNever throws with context", () => {
  expect(() => assertNever("x" as never, "test")).toThrow("test")
})

test("GatewayEvent accepts envelope and flat shapes (compile-time)", () => {
  const a: GatewayEvent = { type: "opencode_event", data: { type: "session.idle", sessionID: "s1" } }
  const b: GatewayEvent = { type: "project_registered", projectDir: "/x" }
  const c: GatewayEvent = { type: "opencode_event", data: { type: "plugin:foo:bar" } }
  expect(a.type).toBe("opencode_event")
  expect(b.type).toBe("project_registered")
  expect(c.type).toBe("opencode_event")
})

test("every runtime type is a dotted name", () => {
  for (const t of RUNTIME_EVENT_TYPES) expect(t).toContain(".")
})
