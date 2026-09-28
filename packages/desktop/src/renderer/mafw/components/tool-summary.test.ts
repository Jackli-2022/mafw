import { describe, test, expect } from "bun:test"
import { summarizeTools } from "./tool-summary"

const tool = (name: string, status = "completed", title?: string, error = false) => ({
  type: "tool",
  tool: name,
  state: { status, title, ...(error ? { error: "boom" } : {}) },
})

describe("summarizeTools", () => {
  test("空输入返回空数组", () => {
    expect(summarizeTools([])).toEqual([])
    expect(summarizeTools([{ type: "text", text: "hi" }])).toEqual([])
  })

  test("同名连续工具合并计数", () => {
    const lines = summarizeTools([tool("read"), tool("read"), tool("read")])
    expect(lines).toEqual([{ icon: "✓", text: "Read ×3", error: undefined }])
  })

  test("不同工具各一行，保留顺序", () => {
    const lines = summarizeTools([tool("read"), tool("grep"), tool("read")])
    expect(lines.map(l => l.text)).toEqual(["Read", "Grep", "Read"])
  })

  test("错误工具标 error", () => {
    const lines = summarizeTools([tool("bash", "completed", undefined, true)])
    expect(lines[0].error).toBe(true)
    expect(lines[0].icon).toBe("✗")
  })

  test("进行中的工具不进入摘要（走现有呼吸态）", () => {
    const lines = summarizeTools([tool("read", "running"), tool("read")])
    expect(lines).toEqual([{ icon: "✓", text: "Read", error: undefined }])
  })

  test("工具名首字母大写", () => {
    expect(summarizeTools([tool("webfetch")])[0].text).toBe("Webfetch")
  })

  test("错误不参与合并（打断连续段）", () => {
    const lines = summarizeTools([tool("read"), tool("read", "error"), tool("read")])
    expect(lines.map(l => l.text)).toEqual(["Read", "Read", "Read"])
  })
})
