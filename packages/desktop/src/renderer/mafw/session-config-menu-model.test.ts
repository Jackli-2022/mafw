import { describe, expect, test } from "bun:test"
import {
  AGENT_SWITCH_OPTIONS,
  THINKING_LEVELS,
  THINKING_MENU_OPTIONS,
  agentBadge,
  findAgentEntry,
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

  test("agentBadge 大小写不敏感（view DTO 的 id 是 Build/Plan）", () => {
    expect(agentBadge("Build")).toBeNull()
    expect(agentBadge("BUILD")).toBeNull()
    expect(agentBadge("Plan")).toBe("plan")
    expect(agentBadge("LEAD")).toBe("lead")
    expect(agentBadge("Manager")).toBe("lead")
    expect(agentBadge("MAFW-CREATE")).toBe("create")
    expect(agentBadge("Custom")).toBe("Custom")
  })

  test("findAgentEntry: 菜单小写 id → 列表里的 Capitalized entry", () => {
    const agents = [{ id: "Build", name: "Build" }, { id: "Plan", name: "Plan" }]
    expect(findAgentEntry(agents, "build")?.id).toBe("Build")
    expect(findAgentEntry(agents, "plan")?.id).toBe("Plan")
    expect(findAgentEntry(agents, "PLAN")?.id).toBe("Plan")
    expect(findAgentEntry(agents, "lead")).toBeUndefined()
    expect(findAgentEntry([] as any[], "build")).toBeUndefined()
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

  test("THINKING_MENU_OPTIONS 默认项在首位（设定后可回退）", () => {
    expect(THINKING_MENU_OPTIONS[0]).toEqual({ id: null, label: "默认" })
    expect(THINKING_MENU_OPTIONS).toHaveLength(8)
    expect(THINKING_MENU_OPTIONS[7]).toEqual({ id: "max", label: "max" })
  })
})
