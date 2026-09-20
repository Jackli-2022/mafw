import { describe, expect, test } from "bun:test"
import { dispatchShellEvent, type ShellEventDeps } from "./dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const deps: ShellEventDeps = {
    core: {
      trace: rec("trace"),
      notify: rec("notify"),
      warn: rec("warn"),
      setActiveQuestion: rec("setActiveQuestion"),
      bumpProjectsRev: rec("bumpProjectsRev"),
      onRuntimeSwitched: rec("onRuntimeSwitched"),
    },
    lifecycle: {
      invalidate: rec("invalidate"),
      patch: rec("patch"),
      retitleOpenTab: rec("retitleOpenTab"),
      remove: rec("remove"),
      closeIfOpen: rec("closeIfOpen"),
    },
    flowCards: {
      upsertCard: rec("upsertCard"),
      resolveCard: rec("resolveCard"),
      setPermissionMode: rec("setPermissionMode"),
      setCompactionMark: rec("setCompactionMark"),
      notify: rec("notify"),
      trace: rec("trace"),
      scheduleReconcile: rec("scheduleReconcile"),
      agentTitleOf: () => "Agent",
      getAskCard: () => undefined,
    },
    dock: {
      trace: rec("trace"),
      getTrajectoryEvents: () => [],
      setTrajectoryEvents: rec("setTrajectoryEvents"),
      setTrajectoryTurn: rec("setTrajectoryTurn"),
      setTodos: rec("setTodos"),
    },
  }
  return { deps, calls }
}

describe("dispatchShellEvent: core events", () => {
  test("user_question → setActiveQuestion + notify", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "user_question", question: "去哪？" }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace", "setActiveQuestion", "notify"])
    expect(calls[1].args[0]).toMatchObject({ type: "user_question" })
  })

  test("project_registered → bumpProjectsRev", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "project_registered", projectDir: "C:\\p" }, deps)
    expect(calls.map(c => c.name)).toContain("bumpProjectsRev")
  })

  test("runtime_switched → onRuntimeSwitched", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "runtime_switched", runtime: "pi" }, deps)
    expect(calls.map(c => c.name)).toContain("onRuntimeSwitched")
  })
})

describe("dispatchShellEvent: session lifecycle", () => {
  test("session.created → lifecycle.invalidate", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.created", sessionID: "s1", properties: { sessionID: "s1", info: { id: "s1", title: "t", directory: "C:\\p" } } }, deps)
    expect(calls.map(c => c.name)).toContain("invalidate")
  })

  test("session.updated with title → patch + retitleOpenTab", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.updated", sessionID: "s1", properties: { sessionID: "s1", info: { id: "s1", title: "new" } } }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace", "patch", "retitleOpenTab"])
    expect(calls[2].args).toEqual(["s1", "new"])
  })

  test("session.deleted → remove + closeIfOpen", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.deleted", sessionID: "s1" }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace", "remove", "closeIfOpen"])
  })

  test("internal session event → only trace (planner none)", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.created", sessionID: "s1", internal: true, properties: { info: { id: "s1", title: "w" } } }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace"])
  })
})

describe("dispatchShellEvent: tail", () => {
  test("unknown type → warn + trace(miss)", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "brand_new_event", sessionID: "s1" }, deps)
    expect(calls.map(c => c.name)).toContain("warn")
    expect(calls.find(c => c.name === "trace")!.args[1]).toBe("miss")
  })

  test("ignored type (user_feedback) → no warn", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "user_feedback", sessionID: "s1" }, deps)
    expect(calls.some(c => c.name === "warn")).toBe(false)
  })
})
