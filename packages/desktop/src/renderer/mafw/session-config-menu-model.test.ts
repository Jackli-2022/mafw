import { describe, expect, test } from "bun:test"
import {
  THINKING_LEVELS,
  THINKING_MENU_OPTIONS,
  agentBadge,
  agentMenuOptions,
  defaultAgentKey,
  findAgentEntry,
  nextRuntimeAgent,
  planningAgent,
  thinkingBadge,
} from "./session-config-menu-model"

// 契约样本：runtime 返回的 MafwAgent[]（source/selectable/default/planning 全部来自 DTO，
// 前端不认 runtime 的原生 agent 名）。
const agents = [
  { id: "lead", label: "lead", source: "mafw", selectable: true },
  { id: "Plan", label: "Plan", source: "runtime", selectable: true },
  { id: "Build", label: "Build", source: "runtime", selectable: true, default: true },
  { id: "Planning", label: "Planning", source: "runtime", selectable: true, planning: true },
  { id: "General", label: "General", source: "runtime", selectable: false },
]

describe("session config menu model", () => {
  test("agentMenuOptions: 只列 runtime 可选项，默认 agent 置顶并带提示", () => {
    expect(agentMenuOptions(agents)).toEqual([
      { id: "Build", label: "Build", hint: "默认" },
      { id: "Plan", label: "Plan" },
      { id: "Planning", label: "Planning" },
    ])
    expect(agentMenuOptions([])).toEqual([])
    // 旧 gateway / pi：没有 runtime agent 时不伪造选项。
    expect(agentMenuOptions([{ id: "lead", label: "lead", source: "mafw", selectable: true }])).toEqual([])
  })

  test("defaultAgentKey / planningAgent 只认 DTO 标记（不按名字猜）", () => {
    expect(defaultAgentKey(agents)).toBe("Build")
    expect(defaultAgentKey([{ id: "Plan", label: "Plan", source: "runtime", selectable: true }])).toBeNull()
    expect(planningAgent(agents)?.id).toBe("Planning")
    expect(planningAgent([{ id: "Plan", label: "Plan", source: "runtime", selectable: true }])).toBeNull()
  })

  test("agentBadge: 默认 agent / 未选择不占位，其余显示 DTO label", () => {
    expect(agentBadge(null, agents)).toBeNull()
    expect(agentBadge(undefined, agents)).toBeNull()
    expect(agentBadge("", agents)).toBeNull()
    expect(agentBadge("Build", agents)).toBeNull()
    expect(agentBadge("build", agents)).toBeNull()
    expect(agentBadge("Plan", agents)).toBe("Plan")
    expect(agentBadge("plan", agents)).toBe("Plan")
    expect(agentBadge("Planning", agents)).toBe("Planning")
    // MAFW 身份不是 runtime 名（lead 由 Pod 管理），仍展示。
    expect(agentBadge("lead", agents)).toBe("lead")
    expect(agentBadge("LEAD", agents)).toBe("lead")
    // 旧数据里的历史值原样展示，不猜 runtime 默认。
    expect(agentBadge("custom", agents)).toBe("custom")
    // 老 gateway 没有 default 标记：只有用户本次显式选择才出徽标（不猜）。
    const noDefault = [{ id: "Plan", label: "Plan", source: "runtime", selectable: true }]
    expect(agentBadge("Plan", noDefault, false)).toBeNull()
    expect(agentBadge("Plan", noDefault, true)).toBe("Plan")
    expect(agentBadge("lead", noDefault, false)).toBeNull()
    expect(agentBadge("lead", noDefault, true)).toBe("lead")
  })

  test("nextRuntimeAgent: 按菜单顺序循环（默认 → 其余 → 默认）", () => {
    expect(nextRuntimeAgent(agents, "Build")?.id).toBe("Plan")
    expect(nextRuntimeAgent(agents, "Plan")?.id).toBe("Planning")
    expect(nextRuntimeAgent(agents, "Planning")?.id).toBe("Build")
    // 无当前选择 → 默认（置顶项）；单 agent 不循环。
    expect(nextRuntimeAgent(agents, null)?.id).toBe("Build")
    expect(nextRuntimeAgent([agents[2]], "Build")).toBeNull()
    expect(nextRuntimeAgent([], null)).toBeNull()
  })

  test("thinkingBadge: 未显式设定不占位，设定后显示档位", () => {
    expect(thinkingBadge(null)).toBeNull()
    expect(thinkingBadge(undefined)).toBeNull()
    expect(thinkingBadge("high")).toBe("⚡ high")
    expect(thinkingBadge("off")).toBe("⚡ off")
  })

  test("findAgentEntry: 菜单 id → 列表 entry（大小写不敏感）", () => {
    const list = [{ id: "Build", label: "Build" }, { id: "Plan", label: "Plan" }]
    expect(findAgentEntry(list, "build")?.id).toBe("Build")
    expect(findAgentEntry(list, "plan")?.id).toBe("Plan")
    expect(findAgentEntry(list, "PLAN")?.id).toBe("Plan")
    expect(findAgentEntry(list, "lead")).toBeUndefined()
    expect(findAgentEntry([] as any[], "build")).toBeUndefined()
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
