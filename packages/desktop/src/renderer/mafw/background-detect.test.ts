import { describe, expect, test } from "bun:test"
import { findBlockingWork } from "./background-detect"

describe("findBlockingWork（前台 blocking 工作）", () => {
  test("最新未完成 assistant 消息里 running 的 shell/subagent 工具", () => {
    const msgs = [
      { id: "m1", role: "assistant", time: { created: 1, completed: 2 } },
      { id: "m2", role: "assistant", time: { created: 2 } },
    ]
    const parts: Record<string, any[]> = {
      m1: [{ type: "tool", tool: "shell", state: { status: "running", input: { command: "old" } } }],
      m2: [{ type: "tool", tool: "shell", state: { status: "running", input: { command: "npm run dev" } } }],
    }
    expect(findBlockingWork(msgs, parts)).toEqual([{ type: "shell", label: "npm run dev" }])
  })

  test("消息已完成 → 无 blocking；非目标工具/非 running 状态忽略", () => {
    const parts: Record<string, any[]> = {
      m9: [{ type: "tool", tool: "shell", state: { status: "running", input: { command: "npm run dev" } } }],
    }
    expect(findBlockingWork([{ id: "m9", role: "assistant", time: { created: 1, completed: 2 } }], parts)).toEqual([])
    expect(findBlockingWork([{ id: "m9", role: "assistant", time: { created: 1 } }], {
      m9: [{ type: "tool", tool: "read", state: { status: "running", input: {} } }],
    })).toEqual([])
    expect(findBlockingWork([{ id: "m9", role: "assistant", time: { created: 1 } }], {
      m9: [{ type: "tool", tool: "shell", state: { status: "completed", input: {} } }],
    })).toEqual([])
  })

  test("subagent 工具使用 description 作为标签", () => {
    expect(findBlockingWork([{ id: "m1", role: "assistant", time: { created: 1 } }], {
      m1: [{ type: "tool", tool: "task", state: { status: "running", input: { description: "调研" } } }],
    })).toEqual([{ type: "subagent", label: "调研" }])
  })
})
