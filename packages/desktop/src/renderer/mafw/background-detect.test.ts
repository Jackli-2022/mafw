import { describe, expect, test } from "bun:test"
import { detectBackgroundPart, detectSyntheticTerminal, scanHistoryForBackground, findBlockingWork } from "./background-detect"

const bgShellPart = {
  type: "tool", tool: "shell",
  state: { status: "completed", metadata: { status: "running", shellID: "sh1" }, input: { command: "npm run dev" } },
}
const bgSubPart = {
  type: "tool", tool: "subagent",
  state: { status: "completed", metadata: { status: "running", sessionID: "child1" }, input: { description: "调研登录" } },
}
const bgShellPartV2 = { ...bgShellPart, tool: undefined, name: "shell" }
const bgSubPartV2 = { ...bgSubPart, tool: undefined, name: "subagent" }

describe("detectBackgroundPart", () => {
  test("v1 tool field shell/subagent → bg-observed", () => {
    expect(detectBackgroundPart(bgShellPart, "s1")).toEqual({
      kind: "bg-observed",
      row: { id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev" },
    })
    expect(detectBackgroundPart(bgSubPart, "s1")).toEqual({
      kind: "bg-observed",
      row: { id: "child1", type: "subagent", sessionID: "s1", label: "调研登录" },
    })
  })

  test("v2.1.0 name field shell/subagent → bg-observed", () => {
    expect(detectBackgroundPart(bgShellPartV2, "s1")).toEqual({
      kind: "bg-observed",
      row: { id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev" },
    })
    expect(detectBackgroundPart(bgSubPartV2, "s1")).toEqual({
      kind: "bg-observed",
      row: { id: "child1", type: "subagent", sessionID: "s1", label: "调研登录" },
    })
  })

  test("foreground blocking part (state.running) is not background", () => {
    expect(detectBackgroundPart({ ...bgShellPart, state: { status: "running", input: { command: "x" } } }, "s1")).toBeNull()
  })

  test("completed without metadata.status=running → null; non-target tool → null", () => {
    expect(detectBackgroundPart({ ...bgShellPart, state: { status: "completed", input: {} } }, "s1")).toBeNull()
    expect(detectBackgroundPart({ type: "tool", tool: "edit", state: bgShellPart.state }, "s1")).toBeNull()
  })
})

describe("detectSyntheticTerminal", () => {
  test("shell completion: type=synthetic + metadata.source=shell + jobID → completed (shellID first, jobID fallback)", () => {
    const info = { id: "m1", type: "synthetic", text: "done", metadata: { source: "shell", shellID: "sh1", jobID: "job1", command: "npm run dev" } }
    expect(detectSyntheticTerminal(info, "s1")).toEqual({
      kind: "bg-terminal", id: "sh1", terminal: "completed", source: "synthetic",
      meta: { type: "shell", sessionID: "s1", label: "npm run dev" },
    })
  })

  test("shell synthetic without jobID converges but does not create a row", () => {
    const info = { id: "m1b", type: "synthetic", metadata: { source: "shell", shellID: "sh-user", command: "ls" } }
    const ev = detectSyntheticTerminal(info, "s1")
    expect(ev).toMatchObject({ kind: "bg-terminal", id: "sh-user", terminal: "completed" })
    expect((ev as any).meta).toBeUndefined()
  })

  test("lenient shape: missing type/role but metadata.source present is recognized", () => {
    const info = { id: "m2", metadata: { source: "subagent", childID: "c9" } }
    expect(detectSyntheticTerminal(info, "s1")).toMatchObject({
      kind: "bg-terminal", id: "c9", terminal: "completed", meta: { type: "subagent" },
    })
  })

  test("failure signal (state=error) → failed; state=cancelled → cancelled", () => {
    const errInfo = { id: "m3", type: "synthetic", metadata: { source: "shell", shellID: "sh1", jobID: "j", state: "error" } }
    expect(detectSyntheticTerminal(errInfo, "s1")).toMatchObject({ terminal: "failed" })
    const cancelInfo = { id: "m3c", type: "synthetic", metadata: { source: "shell", shellID: "sh1", jobID: "j", state: "cancelled" } }
    expect(detectSyntheticTerminal(cancelInfo, "s1")).toMatchObject({ terminal: "cancelled" })
  })

  test("non-zero exit / signal / timeout → failed; exit 0 → completed", () => {
    const base = { id: "m3b", type: "synthetic", metadata: { source: "shell", shellID: "sh1", jobID: "j" } }
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, state: "completed", exit: 1 } }, "s1")).toMatchObject({ terminal: "failed" })
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, signal: "SIGTERM" } }, "s1")).toMatchObject({ terminal: "failed" })
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, timeout: true } }, "s1")).toMatchObject({ terminal: "failed" })
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, state: "completed", exit: 0 } }, "s1")).toMatchObject({ terminal: "completed" })
  })

  test("plain user/assistant message → null", () => {
    expect(detectSyntheticTerminal({ id: "m4", role: "assistant" }, "s1")).toBeNull()
  })
})

describe("scanHistoryForBackground / findBlockingWork", () => {
  test("hydration replay: parts → observed, synthetic → terminal, ascending by created time", () => {
    const items = [
      { info: { id: "m2", type: "synthetic", time: { created: 200 }, metadata: { source: "shell", shellID: "sh1" } }, parts: [] },
      { info: { id: "m1", role: "assistant", time: { created: 100 } }, parts: [bgShellPart] },
    ]
    expect(scanHistoryForBackground(items, "s1").map(e => e.kind)).toEqual(["bg-observed", "bg-terminal"])
  })

  test("blocking: running shell/subagent part in the latest incomplete assistant message", () => {
    const msgs = [{ id: "m9", role: "assistant", time: { created: 1 } }]
    const parts = { m9: [{ type: "tool", tool: "shell", state: { status: "running", input: { command: "npm test" } } }] }
    expect(findBlockingWork(msgs, parts)).toEqual([{ type: "shell", label: "npm test" }])
    expect(findBlockingWork([{ id: "m9", role: "assistant", time: { created: 1, completed: 2 } }], parts)).toEqual([])
  })

  test("blocking reads v2.1.0 name field too", () => {
    const msgs = [{ id: "m10", role: "assistant", time: { created: 1 } }]
    const parts = { m10: [{ type: "tool", name: "shell", state: { status: "running", input: { command: "npm run dev" } } }] }
    expect(findBlockingWork(msgs, parts)).toEqual([{ type: "shell", label: "npm run dev" }])
  })
})
