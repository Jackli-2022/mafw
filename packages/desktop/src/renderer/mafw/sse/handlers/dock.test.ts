import { describe, expect, test } from "bun:test"
import { mergeTrajectoryEvent, handleDockEvent, type DockDeps } from "./dock"
import type { ShellEventDeps } from "../dispatcher"

describe("mergeTrajectoryEvent", () => {
  test("new event appended", () => {
    expect(mergeTrajectoryEvent([{ turnID: 1, seq: 0 }], { turnID: 1, seq: 1 })).toHaveLength(2)
  })
  test("dup by (turnID, seq) → null", () => {
    expect(mergeTrajectoryEvent([{ turnID: 1, seq: 0 }], { turnID: "1", seq: "0" })).toBeNull()
  })
  test("rolling window keeps last 200", () => {
    const prev = Array.from({ length: 200 }, (_, i) => ({ turnID: 0, seq: i }))
    const merged = mergeTrajectoryEvent(prev, { turnID: 0, seq: 200 })!
    expect(merged).toHaveLength(200)
    expect((merged[199] as any).seq).toBe(200)
  })
})

describe("handleDockEvent", () => {
  function makeDeps() {
    const calls: { name: string; args: unknown[] }[] = []
    const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
    let live: Record<string, unknown[]> = {}
    const dock: DockDeps = {
      trace: rec("trace"),
      getTrajectoryEvents: (sid) => live[sid] || [],
      setTrajectoryEvents: (sid, events) => { calls.push({ name: "setTrajectoryEvents", args: [sid, events] }); live = { ...live, [sid]: events } },
      setTrajectoryTurn: rec("setTrajectoryTurn"),
      setTodos: rec("setTodos"),
    }
    return { deps: { dock } as unknown as ShellEventDeps, calls }
  }
  test("todo.updated with array → setTodos", () => {
    const { deps, calls } = makeDeps()
    expect(handleDockEvent({ type: "todo.updated", properties: { todos: [{ content: "x" }] } }, "s1", deps)).toBe(true)
    expect(calls.find(c => c.name === "setTodos")!.args[0]).toBe("s1")
  })
  test("todo.updated non-array → consumed, no setTodos", () => {
    const { deps, calls } = makeDeps()
    expect(handleDockEvent({ type: "todo.updated", properties: {} }, "s1", deps)).toBe(true)
    expect(calls.some(c => c.name === "setTodos")).toBe(false)
  })
  test("trajectory.turn → setTrajectoryTurn", () => {
    const { deps, calls } = makeDeps()
    expect(handleDockEvent({ type: "trajectory.turn", properties: { turnID: 3 } }, "s1", deps)).toBe(true)
    expect(calls.map(c => c.name)).toContain("setTrajectoryTurn")
  })
  test("trajectory.event dedup via getTrajectoryEvents", () => {
    const { deps, calls } = makeDeps()
    const d = (deps as ShellEventDeps).dock
    // 预置已有同 (turnID, seq) 事件 → merge 返回 null → 不写回
    d.getTrajectoryEvents = () => [{ turnID: 1, seq: 0 }]
    expect(handleDockEvent({ type: "trajectory.event", properties: { turnID: "1", seq: "0" } }, "s1", deps)).toBe(true)
    expect(calls.some(c => c.name === "setTrajectoryEvents")).toBe(false)
  })
  test("unrelated → false", () => {
    const { deps } = makeDeps()
    expect(handleDockEvent({ type: "session.idle" }, "s1", deps)).toBe(false)
  })
})
