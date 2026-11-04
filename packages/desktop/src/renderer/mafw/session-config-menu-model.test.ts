import { describe, expect, test } from "bun:test"
import {
  AGENT_SWITCH_OPTIONS,
  THINKING_LEVELS,
  agentBadge,
  thinkingBadge,
} from "./session-config-menu-model"

describe("session config menu model", () => {
  test("agentBadge: 默认/build 不占位，非默认显示短名", () => {
    expect(agentBadge(null)).toBeNull()
    expect(agentBadge(undefined)).toBeNull()
    expect(agentBadge("")).toBeNull()
    expect(agentBadge("build")).toBeNull()
    expect(agentBadge("plan")).toBe("plan")
    expect(agentBadge("lead")).toBe("lead")
    expect(agentBadge("manager")).toBe("lead")
    expect(agentBadge("mafw-create")).toBe("create")
    expect(agentBadge("custom")).toBe("custom")
  })

  test("thinkingBadge: 未显式设定不占位，设定后显示档位", () => {
    expect(thinkingBadge(null)).toBeNull()
    expect(thinkingBadge(undefined)).toBeNull()
    expect(thinkingBadge("high")).toBe("⚡ high")
    expect(thinkingBadge("off")).toBe("⚡ off")
  })

  test("AGENT_SWITCH_OPTIONS 含默认/plan/build（鼠标可回默认）", () => {
    expect(AGENT_SWITCH_OPTIONS).toEqual([
      { id: "default", label: "默认" },
      { id: "plan", label: "plan" },
      { id: "build", label: "build" },
    ])
  })

  test("THINKING_LEVELS 七档齐全且有序", () => {
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
  })
})
