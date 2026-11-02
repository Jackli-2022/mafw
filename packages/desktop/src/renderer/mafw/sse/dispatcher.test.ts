import { describe, expect, test } from "bun:test"
import { dispatchShellEvent, sessionIdOf, type ShellEventDeps } from "./dispatcher"

function makeDeps() {
  const calls: { name: string; args: unknown[] }[] = []
  const rec = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
  const subagentEvents: unknown[] = []
  const backgroundEvents: unknown[] = []
  const taskEvents: unknown[] = []
  const queueEvents: unknown[] = []
  const runEvents: unknown[] = []
  const podEvents: unknown[] = []
  const deps: ShellEventDeps = {
    core: {
      trace: rec("trace"),
      notify: rec("notify"),
      warn: rec("warn"),
      setActiveQuestion: rec("setActiveQuestion"),
      bumpProjectsRev: rec("bumpProjectsRev"),
      onRuntimeSwitched: rec("onRuntimeSwitched"),
      onGoalEvent: rec("onGoalEvent"),
      onCheckpointEvent: rec("onCheckpointEvent"),
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
    background: {
      onEvent: (ev: unknown) => { backgroundEvents.push(ev) },
    },
    tasks: {
      onEvent: (task: unknown) => { taskEvents.push(task) },
    },
    queue: {
      onEvent: (sid: string, ev: unknown) => { queueEvents.push({ sid, ev }) },
    },
    run: {
      onEvent: (run: unknown) => { runEvents.push(run) },
    },
    pod: {
      onEvent: (event: unknown) => { podEvents.push(event) },
    },
  }
  return { deps, calls, subagentEvents, backgroundEvents, taskEvents, queueEvents, runEvents, podEvents }
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

describe("dispatchShellEvent: task updated", () => {
  test("task.updated forwards the task and consumes the event", () => {
    const { deps, taskEvents, calls } = makeDeps()
    const task = { id: "t1", status: "working", parentSessionID: "p1" }
    dispatchShellEvent({ type: "task.updated", properties: { task } }, deps)
    expect(taskEvents).toEqual([task])
    expect(calls.some(c => c.name === "trace" && c.args[1] === "task:updated")).toBe(true)
  })
})

describe("dispatchShellEvent: run updated", () => {
  test("run.updated forwards the run payload and consumes the event", () => {
    const { deps, runEvents, calls } = makeDeps()
    const run = { id: "run_1", sessionID: "s1", status: "suspended" }
    dispatchShellEvent({ type: "run.updated", properties: { sessionID: "s1", run } }, deps)
    expect(runEvents).toEqual([run])
    expect(calls.some(c => c.name === "trace" && c.args[1] === "run:updated")).toBe(true)
  })
})

describe("dispatchShellEvent: pod updated", () => {
  test("pod.updated forwards the event and consumes it", () => {
    const { deps, podEvents, calls } = makeDeps()
    const event = { type: "pod.updated", properties: { podId: "pod_1", kind: "task" } }
    dispatchShellEvent(event, deps)
    expect(podEvents).toEqual([event])
    expect(calls.some(c => c.name === "trace" && c.args[1] === "pod:updated")).toBe(true)
  })
})

describe("dispatchShellEvent: queue updated", () => {
  test("queue.updated forwards session id and event to the queue dep", () => {
    const { deps, queueEvents } = makeDeps()
    const event = { type: "queue.updated", properties: { sessionID: "s1", items: [], action: "enqueue" } }
    dispatchShellEvent(event as any, deps)
    expect(queueEvents).toHaveLength(1)
    expect(queueEvents[0]).toMatchObject({ sid: "s1" })
  })
})

describe("dispatchShellEvent: form refresh", () => {
  test("form.created triggers an immediate reconcile", () => {
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "form.created" }, deps)
    expect(calls.some(c => c.name === "scheduleReconcile" && c.args[0] === 50)).toBe(true)
  })
})

describe("dispatchShellEvent: subagent tool part", () => {
  test("part.updated subagent metadata.sessionID reaches tracker before chat-stream consumes it", () => {
    const { deps, subagentEvents } = makeDeps()
    dispatchShellEvent({
      type: "part.updated",
      properties: {
        sessionID: "parent1",
        part: {
          type: "tool",
          tool: "subagent",
          sessionID: "parent1",
          state: {
            status: "running",
            input: { description: "Builder check", agent: "general" },
            metadata: { sessionID: "child1" },
          },
        },
      },
    }, deps)
    expect(subagentEvents).toContainEqual({
      kind: "session-created",
      info: { id: "child1", parentID: "parent1", title: "Builder check", agent: "general" },
    })
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

describe("dispatchShellEvent: session.checkpoint", () => {
  test("session.checkpoint 顶层消费 → onCheckpointEvent，不 missTrace", () => {
    // W0-1（2026-10-28）：overlay 打开期间 auto checkpoint 实时出现。
    const { deps, calls } = makeDeps()
    dispatchShellEvent({ type: "session.checkpoint", sessionID: "s1", properties: {} }, deps)
    expect(calls.some(c => c.name === "onCheckpointEvent")).toBe(true)
    expect(calls.filter(c => c.name === "warn").length).toBe(0)
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

describe("dispatchShellEvent: background 组（canonical jobs）", () => {
  const job = {
    id: "sh1",
    source: "runtime-shell" as const,
    kind: "shell" as const,
    status: "running" as const,
    sessionID: "s1",
    command: "npm run dev",
  }

  test("background.job.updated → 转发中性 job（dedupe 由 store 负责）", () => {
    const { deps, backgroundEvents } = makeDeps()
    dispatchShellEvent({ type: "background.job.updated", sessionID: "s1", properties: { job } }, deps)
    expect(backgroundEvents).toEqual([job])
  })

  test("旧推导路径退役：part 元数据 / synthetic 消息 / turn 都不再自建后台行", () => {
    const { deps, backgroundEvents } = makeDeps()
    const bgPart = { type: "tool", tool: "shell", state: { status: "completed", metadata: { status: "running", shellID: "sh1" }, input: { command: "npm run dev" } } }
    dispatchShellEvent({ type: "part.updated", sessionID: "s1", properties: { part: { ...bgPart, messageID: "m1", sessionID: "s1" } } }, deps)
    dispatchShellEvent({ type: "message.updated", sessionID: "s1", properties: { message: { id: "m1", type: "synthetic", metadata: { source: "shell", shellID: "sh1" } } } }, deps)
    dispatchShellEvent({ type: "turn.completed", properties: { sessionID: "child1" } }, deps)
    expect(backgroundEvents).toEqual([])
  })

  test("background.job.updated 缺 job → 不转发、不崩", () => {
    const { deps, backgroundEvents } = makeDeps()
    dispatchShellEvent({ type: "background.job.updated", sessionID: "s1", properties: {} }, deps)
    expect(backgroundEvents).toEqual([])
  })
})

describe("sessionIdOf", () => {
  test("message.updated canonical payload resolves sid from properties.message (Task 14)", () => {
    expect(sessionIdOf({ type: "message.updated", properties: { message: { id: "m1", sessionID: "s9" } } })).toBe("s9")
  })

  test("prefers top-level / properties sessionID over message fallback", () => {
    expect(sessionIdOf({ sessionID: "top", properties: { sessionID: "prop", message: { sessionID: "m" } } })).toBe("top")
    expect(sessionIdOf({ properties: { sessionID: "prop", message: { sessionID: "m" } } })).toBe("prop")
  })

  test("session lifecycle wire info fallback retained (properties.info.sessionID)", () => {
    expect(sessionIdOf({ type: "session.updated", properties: { info: { id: "s1", sessionID: "s1" } } })).toBe("s1")
  })
})
