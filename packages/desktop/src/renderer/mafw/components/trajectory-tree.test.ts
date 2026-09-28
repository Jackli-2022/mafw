import { describe, test, expect } from "bun:test"
import { buildCallTree } from "./trajectory-tree"

const ev = (seq: number, eventType: string, extra: any = {}): any => ({ seq, eventType, ...extra })

describe("buildCallTree", () => {
  test("tool_start/end 配对为一个 tool 节点并带时长", () => {
    const tree = buildCallTree([
      ev(1, "tool_start", { toolName: "read" }),
      ev(2, "tool_end", { toolName: "read", toolState: "completed", durationMs: 120 }),
    ])
    expect(tree).toEqual([
      { key: "1", kind: "tool", label: "read", error: false, durationMs: 120, children: [] },
    ])
  })

  test("tool 内子代理事件嵌套为 children", () => {
    const tree = buildCallTree([
      ev(1, "tool_start", { toolName: "task" }),
      ev(2, "tool_start", { toolName: "read", agent: "explore" }),
      ev(3, "tool_end", { toolName: "read", agent: "explore", toolState: "completed" }),
      ev(4, "tool_end", { toolName: "task", toolState: "completed" }),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].label).toBe("read")
  })

  test("未配对 start 保留为进行态节点（durationMs null）", () => {
    const tree = buildCallTree([ev(1, "tool_start", { toolName: "bash" })])
    expect(tree[0].durationMs).toBeNull()
  })

  test("error 状态冒泡", () => {
    const tree = buildCallTree([
      ev(1, "tool_start", { toolName: "bash" }),
      ev(2, "tool_end", { toolName: "bash", toolState: "error" }),
    ])
    expect(tree[0].error).toBe(true)
  })

  test("reasoning 对合并；生命周期事件归 other", () => {
    const tree = buildCallTree([
      ev(1, "reasoning_start"),
      ev(2, "reasoning_end", { durationMs: 800 }),
      ev(3, "turn_start"),
    ])
    expect(tree.map(n => n.kind)).toEqual(["reasoning", "other"])
  })

  test("乱序 end（父级后闭合）不破坏嵌套", () => {
    const tree = buildCallTree([
      ev(1, "tool_start", { toolName: "task" }),
      ev(2, "tool_start", { toolName: "read" }),
      ev(3, "tool_end", { toolName: "read" }),
      ev(4, "model_switch", { model: "m" }),
      ev(5, "tool_end", { toolName: "task" }),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].label).toBe("task")
    expect(tree[0].children.map(c => c.label)).toEqual(["read", "m"])
    expect(tree[0].durationMs).toBeNull()
  })
})
