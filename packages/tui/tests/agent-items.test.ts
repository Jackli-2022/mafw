import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { agentSelectItems } from "../src/ui/agent-items.ts"

describe("agentSelectItems (opencode 2.1.0 id/name split)", () => {
  test("运行时 agent：value=id，label=显示名", () => {
    const items = agentSelectItems([
      { id: "build", name: "Build", mode: "primary", description: "默认执行" },
      { id: "plan", name: "Plan", mode: "primary" },
    ])
    assert.deepEqual(items, [
      { value: "build", label: "Build", description: "默认执行" },
      { value: "plan", label: "Plan", description: "primary" },
    ])
  })

  test("MAFW 注册表身份只有 name：value 回退 name", () => {
    const items = agentSelectItems([{ name: "manager", mode: "primary" }])
    assert.deepEqual(items, [{ value: "manager", label: "manager", description: "primary" }])
  })

  test("hidden 与空行被过滤", () => {
    const items = agentSelectItems([
      { id: "compaction", name: "Compaction", hidden: true },
      { id: "", name: "" },
      { id: "explore", name: "Explore" },
    ])
    assert.deepEqual(items.map((x) => x.value), ["explore"])
  })
})
