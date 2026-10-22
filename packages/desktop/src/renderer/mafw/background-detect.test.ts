import { describe, expect, test } from "bun:test"
import { detectBackgroundPart, detectSyntheticTerminal, scanHistoryForBackground, findBlockingWork } from "./background-detect"

const bgShellPart = { type: "tool", tool: "shell", state: { status: "completed", metadata: { status: "running", shellID: "sh1" }, input: { command: "npm run dev" } } }
const bgSubPart = { type: "tool", tool: "subagent", state: { status: "completed", metadata: { status: "running", sessionID: "child1" }, input: { description: "调研登录" } } }

describe("detectBackgroundPart", () => {
  test("shell/subagent 后台 part → bg-observed（label 取 input.command/description）", () => {
    expect(detectBackgroundPart(bgShellPart, "s1")).toEqual({ kind: "bg-observed", row: { id: "sh1", type: "shell", sessionID: "s1", label: "npm run dev" } })
    expect(detectBackgroundPart(bgSubPart, "s1")).toEqual({ kind: "bg-observed", row: { id: "child1", type: "subagent", sessionID: "s1", label: "调研登录" } })
  })
  test("前台 blocking part（state.running）不判后台（Review Focus #2）", () => {
    expect(detectBackgroundPart({ ...bgShellPart, state: { status: "running", input: { command: "x" } } }, "s1")).toBeNull()
  })
  test("completed 但无 metadata.status=running → null；非目标工具 → null", () => {
    expect(detectBackgroundPart({ ...bgShellPart, state: { status: "completed", input: {} } }, "s1")).toBeNull()
    expect(detectBackgroundPart({ type: "tool", tool: "edit", state: bgShellPart.state }, "s1")).toBeNull()
  })
})

describe("detectSyntheticTerminal", () => {
  test("shell 完成：type=synthetic + metadata.source=shell + jobID → completed（消项键 shellID 优先、jobID 兜底）", () => {
    const info = { id: "m1", type: "synthetic", text: "done", metadata: { source: "shell", shellID: "sh1", jobID: "job1", command: "npm run dev" } }
    expect(detectSyntheticTerminal(info, "s1")).toEqual({ kind: "bg-terminal", id: "sh1", terminal: "completed", source: "synthetic", meta: { type: "shell", sessionID: "s1", label: "npm run dev" } })
  })
  test("无 jobID 的 shell synthetic（用户手动 shell）→ 可收敛不建行（meta 缺省，reviewer #13）", () => {
    const info = { id: "m1b", type: "synthetic", metadata: { source: "shell", shellID: "sh-user", command: "ls" } }
    const ev = detectSyntheticTerminal(info, "s1")
    expect(ev).toMatchObject({ kind: "bg-terminal", id: "sh-user", terminal: "completed" })
    expect((ev as any).meta).toBeUndefined()
  })
  test("宽容判定：缺 type/role 但 metadata.source 存在也识别（Review Focus #1）", () => {
    const info = { id: "m2", metadata: { source: "subagent", childID: "c9" } }
    expect(detectSyntheticTerminal(info, "s1")).toMatchObject({ kind: "bg-terminal", id: "c9", terminal: "completed", meta: { type: "subagent" } })
  })
  test("失败信号（state/error 字段或文本）→ failed；cancelled → cancelled", () => {
    const errInfo = { id: "m3", type: "synthetic", metadata: { source: "shell", shellID: "sh1", jobID: "j", state: "error" } }
    expect(detectSyntheticTerminal(errInfo, "s1")).toMatchObject({ terminal: "failed" })
  })
  test("非零 exit / signal / timeout → failed（bundle 实证：后台失败不带 state:error，reviewer Critical 3）", () => {
    const base = { id: "m3b", type: "synthetic", metadata: { source: "shell", shellID: "sh1", jobID: "j" } }
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, state: "completed", exit: 1 } }, "s1")).toMatchObject({ terminal: "failed" })
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, signal: "SIGTERM" } }, "s1")).toMatchObject({ terminal: "failed" })
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, timeout: true } }, "s1")).toMatchObject({ terminal: "failed" })
    expect(detectSyntheticTerminal({ ...base, metadata: { ...base.metadata, state: "completed", exit: 0 } }, "s1")).toMatchObject({ terminal: "completed" })
  })
  test("普通 user/assistant 消息 → null", () => {
    expect(detectSyntheticTerminal({ id: "m4", role: "assistant" }, "s1")).toBeNull()
  })
})

describe("scanHistoryForBackground / findBlockingWork", () => {
  test("水合回放：parts → observed、synthetic → terminal，按时间升序；与既有行幂等", () => {
    const items = [
      { info: { id: "m2", type: "synthetic", time: { created: 200 }, metadata: { source: "shell", shellID: "sh1" } }, parts: [] },
      { info: { id: "m1", role: "assistant", time: { created: 100 } }, parts: [bgShellPart] },
    ]
    const evs = scanHistoryForBackground(items, "s1")
    expect(evs.map(e => e.kind)).toEqual(["bg-observed", "bg-terminal"]) // 升序回放
  })
  test("blocking：最新未完成 assistant 消息的 running shell/subagent part", () => {
    const msgs = [{ id: "m9", role: "assistant", time: { created: 1 } }] // 无 completed
    const parts = { m9: [{ type: "tool", tool: "shell", state: { status: "running", input: { command: "npm test" } } }] }
    expect(findBlockingWork(msgs, parts)).toEqual([{ type: "shell", label: "npm test" }])
    expect(findBlockingWork([{ id: "m9", role: "assistant", time: { created: 1, completed: 2 } }], parts)).toEqual([])
  })
})
