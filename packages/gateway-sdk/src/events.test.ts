import { test, expect } from "bun:test"
import {
  RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES,
  assertNever, type GatewayEvent,
} from "./events"

test("runtime event list has no duplicates", () => {
  expect(new Set(RUNTIME_EVENT_TYPES).size).toBe(RUNTIME_EVENT_TYPES.length)
  // 32 = 31 + background.job.updated（Task 3 三源统一后台作业，2026-11-02）
  expect(RUNTIME_EVENT_TYPES.length).toBe(32)
  expect(RUNTIME_EVENT_TYPES).toContain("pod.updated")
  expect(RUNTIME_EVENT_TYPES).toContain("background.job.updated")
})

test("flat event list has no duplicates", () => {
  expect(new Set(FLAT_EVENT_TYPES).size).toBe(FLAT_EVENT_TYPES.length)
  // 16 = 15 + plugins.changed（Task 6 unified plugin revisions）
  expect(FLAT_EVENT_TYPES.length).toBe(16)
  expect(FLAT_EVENT_TYPES).toContain("plugins.changed")
})

test("assertNever throws with context", () => {
  expect(() => assertNever("x" as never, "test")).toThrow("test")
})

test("GatewayEvent accepts envelope and flat shapes (compile-time)", () => {
  const a: GatewayEvent = { type: "mafw_event", data: { type: "turn.completed", sessionID: "s1" } }
  const b: GatewayEvent = { type: "project_registered", projectDir: "/x" }
  const c: GatewayEvent = { type: "mafw_event", data: { type: "plugin:foo:bar" } }
  expect(a.type).toBe("mafw_event")
  expect(b.type).toBe("project_registered")
  expect(c.type).toBe("mafw_event")
})

test("every runtime type is a dotted name (permission_mode is the sole flat exception)", () => {
  for (const t of RUNTIME_EVENT_TYPES) expect(t === "permission_mode" || t.includes(".")).toBe(true)
})
