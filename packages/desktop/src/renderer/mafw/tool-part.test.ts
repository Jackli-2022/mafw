import { describe, expect, test } from "bun:test"
import { normalizeToolPart, toolNameOf } from "./tool-part"

describe("tool-part（v2.1.0 name → tool 归一化）", () => {
  test("toolNameOf prefers tool, falls back to name", () => {
    expect(toolNameOf({ type: "tool", tool: "bash" })).toBe("bash")
    expect(toolNameOf({ type: "tool", name: "shell" })).toBe("shell")
    expect(toolNameOf({ type: "tool", tool: "bash", name: "shell" })).toBe("bash")
    expect(toolNameOf({ type: "tool" })).toBeUndefined()
    expect(toolNameOf({ type: "text", name: "x" })).toBeUndefined()
    expect(toolNameOf(null)).toBeUndefined()
  })

  test("normalizeToolPart fills tool from name (v2.1.0)", () => {
    const out = normalizeToolPart({ type: "tool", name: "subagent", state: { status: "completed" } })
    expect(out.tool).toBe("subagent")
    expect(out.name).toBe("subagent")
  })

  test("normalizeToolPart keeps an existing tool", () => {
    const part = { type: "tool", tool: "bash", name: "shell" }
    expect(normalizeToolPart(part)).toBe(part)
  })

  test("normalizeToolPart passes non-tool parts through", () => {
    const part = { type: "text", text: "hi" }
    expect(normalizeToolPart(part)).toBe(part)
  })
})
