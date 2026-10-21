import { describe, expect, test } from "bun:test"
import { dispatchShellEvent, type ShellEventDeps } from "./dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const subagentEvents: unknown[] = []
  const deps: ShellEventDeps = {
    core: {
      trace: rec("trace"),
      notify: rec("notify"),
      warn: rec("warn"),
      setActiveQuestion: rec("setActiveQuestion"),
      bumpProjectsRev: rec("bumpProjectsRev"),
      onRuntimeSwitched: rec("onRuntimeSwitched"),
      onGoalEvent: rec("onGoalEvent"),
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
    chat: {
      trace: rec("trace"),
      getStore: () => ({ message: {}, part: {}, session_status: {} }) as any,
      patchStore: rec("patchStore"),
      setSessionStatus: rec("setSessionStatus"),
      markSessionDone: rec("markSessionDone"),
      setUserMsgId: rec("setUserMsgId"),
      parentFallback: () => null,
      phase: rec("phase"),
      onTurnSettled: rec("onTurnSettled"),
      notifyIdle: rec("notifyIdle"),
      mediaSpeak: rec("mediaSpeak"),
    },
    diff: {
      trace: rec("trace"),
      setSessionDiff: rec("setSessionDiff"),
    },
    subagents: {
      onEvent: (ev: unknown) => { subagentEvents.push(ev) },
    },
  }
  return { deps, calls, subagentEvents }
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

  test("opencode v2 sync envelope → consumed silently (gateway drops upstream)", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "sync", syncEvent: { type: "session.updated.1", aggregateID: "s1", data: { sessionID: "s1" } } }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace"])
    expect(calls[0].args[1]).toBe("sync-envelope")
  })

  test("connected greeting frame → consumed silently (no more miss warn)", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "connected", timestamp: "2026-10-12T00:00:00Z" }, deps)
    expect(calls.map(c => c.name)).toEqual(["trace"])
    expect(calls[0].args[1]).toBe("conn:greeting")
  })
})

describe("dispatchShellEvent: goal events", () => {
  test("goal_node 顶层消费 → onGoalEvent，不 missTrace", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "goal_node", goalId: "g1", node: "execute", transition: "finished" }, deps)
    expect(calls.some(c => c.name === "onGoalEvent")).toBe(true)
    expect(calls.filter(c => c.name === "warn").length).toBe(0)
  })
  test("goal_created / phase_transition 同样触发 onGoalEvent", () => {
    for (const type of ["goal_created", "phase_transition"]) {
      const { deps, calls } = makeDeps()
      dispatchShellEvent({ type, goalId: "g1" }, deps)
      expect(calls.some(c => c.name === "onGoalEvent")).toBe(true)
    }
  })
})

describe("dispatchShellEvent: subagents 组", () => {
  test("session.created 带 parentID → 转发（且既有 lifecycle 行为不变：child 被 planner 隐藏）", () => {
    const { deps, calls, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "session.created", properties: { info: { id: "c1", parentID: "p1", title: "t @a" } } }, deps)
    expect(subagentEvents).toEqual([{ kind: "session-created", info: { id: "c1", parentID: "p1", title: "t @a" } }])
    expect(calls.some(c => c.name === "invalidate")).toBe(false) // 子会话不进 Rail 列表
  })
  test("session.updated 子会话 → 转发 title；session.deleted → 转发", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "session.updated", properties: { info: { id: "c1", parentID: "p1", title: "新 @b" } } }, deps)
    dispatchShellEvent({ type: "session.deleted", properties: { sessionID: "c1" } }, deps)
    expect(subagentEvents).toEqual([
      { kind: "session-updated", sessionID: "c1", title: "新 @b" },
      { kind: "session-deleted", sessionID: "c1" },
    ])
  })
  test("turn 三元组 → onEvent turn-terminal（sid=child）", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "turn.completed", properties: { sessionID: "c1" } }, deps)
    expect(subagentEvents).toEqual([{ kind: "turn-terminal", sessionID: "c1", terminal: "completed" }])
  })
  test("turn.failed / turn.aborted 同样转发（六事件覆盖补齐）", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "turn.failed", properties: { sessionID: "c1" } }, deps)
    dispatchShellEvent({ type: "turn.aborted", properties: { sessionID: "c2" } }, deps)
    expect(subagentEvents).toEqual([
      { kind: "turn-terminal", sessionID: "c1", terminal: "failed" },
      { kind: "turn-terminal", sessionID: "c2", terminal: "aborted" },
    ])
  })
  test("非子会话事件不产生 subagent 转发（session.created 无 parentID）", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({ type: "session.created", properties: { info: { id: "s1", title: "普通" } } }, deps)
    expect(subagentEvents).toEqual([])
  })
})
