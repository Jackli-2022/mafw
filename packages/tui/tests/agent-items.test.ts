import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { agentSelectItems } from "../src/ui/agent-items.ts"
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
