import { describe, expect, test } from "bun:test"
import { mcpFilterMatches, mcpStatusLabel, mcpStatusTone, summarizeMcpServers } from "./mcp-page-model"

describe("mcpStatusLabel", () => {
  test("maps runtime statuses to readable labels", () => {
    expect(mcpStatusLabel("connected")).toBe("已连接")
    expect(mcpStatusLabel("needs_auth")).toBe("需要认证")
    expect(mcpStatusLabel("failed")).toBe("连接失败")
    expect(mcpStatusLabel("disabled")).toBe("已禁用")
    expect(mcpStatusLabel("weird")).toBe("未知")
    expect(mcpStatusLabel(undefined)).toBe("未知")
  })
})

describe("mcpStatusTone", () => {
  test("connected → ok, needs_auth → warn, failed → fail, rest muted", () => {
    expect(mcpStatusTone("connected")).toBe("ok")
    expect(mcpStatusTone("needs_auth")).toBe("warn")
    expect(mcpStatusTone("failed")).toBe("fail")
    expect(mcpStatusTone("disabled")).toBe("muted")
    expect(mcpStatusTone("unknown")).toBe("muted")
  })
})

describe("summarizeMcpServers", () => {
  test("counts every bucket and tolerates undefined", () => {
    expect(summarizeMcpServers(undefined)).toEqual({ total: 0, connected: 0, needsAuth: 0, failed: 0, offline: 0 })
    expect(summarizeMcpServers([
      { status: "connected" },
      { status: "connected" },
      { status: "needs_auth" },
      { status: "failed" },
      { status: "disabled" },
      { status: "unknown" },
    ])).toEqual({ total: 6, connected: 2, needsAuth: 1, failed: 1, offline: 2 })
  })
})

describe("mcpFilterMatches", () => {
  test("all / connected / attention", () => {
    expect(mcpFilterMatches("connected", "all")).toBe(true)
    expect(mcpFilterMatches("connected", "connected")).toBe(true)
    expect(mcpFilterMatches("connected", "attention")).toBe(false)
    expect(mcpFilterMatches("needs_auth", "attention")).toBe(true)
    expect(mcpFilterMatches("failed", "attention")).toBe(true)
    expect(mcpFilterMatches("disabled", "attention")).toBe(false)
  })
})
