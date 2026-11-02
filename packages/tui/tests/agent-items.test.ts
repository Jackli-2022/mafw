import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { agentPickerItems, agentSelectItems, showAgentPickerWith, type AgentSelectItem } from "../src/ui/agent-items.ts"
import { normalizeAgents } from "../src/store/dto.ts"

describe("agentSelectItems（MafwAgent 中性 DTO）", () => {
  test("selectable 才进列表：value=id，label=label", () => {
    const items = agentSelectItems([
      { id: "build", label: "Build", source: "runtime", selectable: true, description: "默认执行" },
      { id: "plan", label: "Plan", source: "runtime", selectable: true, mode: "primary" },
    ])
    assert.deepEqual(items, [
      { value: "build", label: "Build", description: "默认执行" },
      { value: "plan", label: "Plan", description: "primary" },
    ])
  })

  test("不可选（subagent / 未物化）被过滤", () => {
    const items = agentSelectItems(normalizeAgents([
      { id: "build", name: "Build", mode: "primary" },
      { id: "compaction", name: "Compaction", hidden: true },
      { name: "mafw-plan", scope: "global", materialized: false },
    ]))
    assert.deepEqual(items.map((x) => x.value), ["build"])
  })

  test("id 为空的行被过滤（不伪造 value）", () => {
    const items = agentSelectItems([
      { id: "", label: "空", source: "runtime", selectable: true },
      { id: "explore", label: "Explore", source: "runtime", selectable: true },
    ])
    assert.deepEqual(items.map((x) => x.value), ["explore"])
  })
})

describe("/agent picker 接线（review I1：client.agents.list() 已是数组）", () => {
  test("非空 agents 数组打开 picker：默认行 + agent 行", async () => {
    let rows: AgentSelectItem[] = []
    const result = await showAgentPickerWith({
      load: async () => [
        { id: "build", name: "Build", mode: "primary", description: "默认执行" },
        { id: "plan", name: "Plan", mode: "primary" },
      ],
      pick: (items) => { rows = items },
    })
    assert.equal(result, null, "打开成功返回 null")
    assert.deepEqual(rows.map((r) => r.value), ["__default__", "build", "plan"])
    assert.equal(rows[1].label, "Build")
    assert.equal(rows[1].description, "默认执行")
  })

  test("agentPickerItems 直接吃数组（不再假设 {items} 信封）", () => {
    const items = agentPickerItems([{ id: "build", name: "Build", mode: "primary" }])
    assert.deepEqual(items.map((r) => r.value), ["__default__", "build"])
    // 容错：旧 / 其他调用方传信封也仍可用
    assert.deepEqual(
      agentPickerItems({ items: [{ id: "build", name: "Build", mode: "primary" }] }).map((r) => r.value),
      ["__default__", "build"],
    )
  })

  test("空数组不打开 picker，返回中性提示", async () => {
    let opened = false
    const result = await showAgentPickerWith({
      load: async () => [],
      pick: () => { opened = true },
    })
    assert.equal(opened, false)
    assert.match(result ?? "", /无可用 agent/)
  })

  test("加载失败不抛错，返回中性文案", async () => {
    const result = await showAgentPickerWith({
      load: async () => { throw new Error("gateway down") },
      pick: () => {},
    })
    assert.match(result ?? "", /无法获取 agent 列表/)
  })
})
