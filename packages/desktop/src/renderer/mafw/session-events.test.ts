// Tests for session-events planner: maps raw /api/events SSE lifecycle events
// to sessionStore actions. Parity with gateway isHiddenSession + no-overwrite
// guard for local-only fields (metadata.mafw.role) that broadcast info lacks.
import { describe, expect, test } from "bun:test"
import { RUNTIME_EVENT_TYPES, FLAT_EVENT_TYPES } from "@mafw/sdk"
import {
  planSessionEvent,
  IGNORED_AT_SHELL,
  isTailAccountedAtShell,
  assertShellEventCoverage,
} from "./session-events"

const createdEvent = (info: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "session.created",
  sessionID: info.id as string,
  properties: { sessionID: info.id, info },
  ...extra,
})

describe("planSessionEvent: session.created", () => {
  test("maps a normal session to invalidate carrying info.directory", () => {
    const action = planSessionEvent(
      createdEvent({ id: "s1", title: "hi", directory: "C:\\proj", time: { updated: 1 } }),
    )
    expect(action).toEqual({ kind: "invalidate", directory: "C:\\proj" })
  })

  test("internal-flagged session is ignored", () => {
    const action = planSessionEvent(createdEvent({ id: "s1", title: "w" }, { internal: true }))
    expect(action).toEqual({ kind: "none" })
  })

  test("subagent child (parentID) is ignored", () => {
    const action = planSessionEvent(createdEvent({ id: "s1", title: "child", parentID: "par" }))
    expect(action).toEqual({ kind: "none" })
  })

  test.each(["# Memory Index scan", '{"relevant_ids":1', "```json", "标题：foo"])(
    "legacy worker title prefix %j is ignored",
    title => {
      const action = planSessionEvent(createdEvent({ id: "s1", title }))
      expect(action).toEqual({ kind: "none" })
    },
  )
})

describe("planSessionEvent: session.updated", () => {
  test("patches title and time.updated from info", () => {
    const action = planSessionEvent({
      type: "session.updated",
      sessionID: "s1",
      properties: { sessionID: "s1", info: { id: "s1", title: "new", time: { updated: 42 } } },
    })
    expect(action).toEqual({ kind: "patch", id: "s1", patch: { title: "new", time: { updated: 42 } } })
  })

  test("patch never carries metadata (local mafw.role must survive)", () => {
    // Broadcast info has no mafw metadata; a naive spread would erase the
    // local manager marker. The patch must only contain whitelisted fields.
    const action = planSessionEvent({
      type: "session.updated",
      sessionID: "s1",
      properties: {
        sessionID: "s1",
        info: { id: "s1", title: "t", time: { updated: 1 }, metadata: { mafw: { role: "manager" } } },
      },
    })
    expect(action).toEqual({ kind: "patch", id: "s1", patch: { title: "t", time: { updated: 1 } } })
  })

  test("omits absent fields (no title -> no title key)", () => {
    const action = planSessionEvent({
      type: "session.updated",
      sessionID: "s1",
      properties: { sessionID: "s1", info: { id: "s1", time: { updated: 7 } } },
    })
    expect(action).toEqual({ kind: "patch", id: "s1", patch: { time: { updated: 7 } } })
  })

  test("pi-style empty shell (no info) is ignored", () => {
    const action = planSessionEvent({ type: "session.updated", sessionID: "s1", properties: { sessionID: "s1" } })
    expect(action).toEqual({ kind: "none" })
  })

  test("internal-flagged update is ignored", () => {
    const action = planSessionEvent({
      type: "session.updated",
      sessionID: "s1",
      internal: true,
      properties: { sessionID: "s1", info: { id: "s1", title: "t" } },
    })
    expect(action).toEqual({ kind: "none" })
  })

  test("subagent child update is ignored", () => {
    const action = planSessionEvent({
      type: "session.updated",
      sessionID: "s1",
      properties: { sessionID: "s1", info: { id: "s1", title: "t", parentID: "p" } },
    })
    expect(action).toEqual({ kind: "none" })
  })

  test("falls back to info.id when top-level sessionID missing (v1 shape)", () => {
    const action = planSessionEvent({
      type: "session.updated",
      properties: { info: { id: "s9", title: "v1", time: { updated: 3 } } },
    })
    expect(action).toEqual({ kind: "patch", id: "s9", patch: { title: "v1", time: { updated: 3 } } })
  })
})

describe("planSessionEvent: session.deleted", () => {
  test("maps to remove by id", () => {
    const action = planSessionEvent({
      type: "session.deleted",
      sessionID: "s1",
      properties: { sessionID: "s1", info: { id: "s1", title: "gone" } },
    })
    expect(action).toEqual({ kind: "remove", id: "s1" })
  })
})

describe("planSessionEvent: other events", () => {
  test("unrelated types yield none", () => {
    expect(planSessionEvent({ type: "message.updated", sessionID: "s1", properties: { sessionID: "s1" } })).toEqual({
      kind: "none",
    })
    expect(planSessionEvent({})).toEqual({ kind: "none" })
  })
})

describe("shell event coverage guard", () => {
  test("IGNORED_AT_SHELL entries are real canonical types", () => {
    const known = new Set<string>([...RUNTIME_EVENT_TYPES, ...FLAT_EVENT_TYPES])
    for (const t of IGNORED_AT_SHELL) {
      expect(known.has(t)).toBe(true)
    }
  })

  test("planner-consumed lifecycle types are not in the ignore list", () => {
    for (const t of ["session.created", "session.updated", "session.deleted"]) {
      expect(IGNORED_AT_SHELL).not.toContain(t)
    }
  })

  test("isTailAccountedAtShell: else-if chain types and prefixes accounted", () => {
    expect(isTailAccountedAtShell("message.part.updated")).toBe(true)
    expect(isTailAccountedAtShell("message.complete")).toBe(true)
    expect(isTailAccountedAtShell("session.idle")).toBe(true)
    expect(isTailAccountedAtShell("plugin:myplug:done")).toBe(true)
    expect(isTailAccountedAtShell("session.next.tool.updated")).toBe(true)
    expect(isTailAccountedAtShell("goal_created")).toBe(true)
    expect(isTailAccountedAtShell(undefined)).toBe(true)
  })

  test("isTailAccountedAtShell: unknown future types are NOT accounted (miss detection)", () => {
    expect(isTailAccountedAtShell("session.somehow.new")).toBe(false)
    expect(isTailAccountedAtShell("message.chunk.merged")).toBe(false)
  })

  test("coverage function runs without throwing on a known type (compile-time is the real guard)", () => {
    expect(() =>
      assertShellEventCoverage({ type: "opencode_event", data: { type: "session.idle", sessionID: "s1" } }),
    ).not.toThrow()
  })
})
