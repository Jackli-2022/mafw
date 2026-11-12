import { test } from "node:test"
import assert from "node:assert/strict"
import { agentContractFor } from "./agent-contract"

function goal(overrides: Record<string, unknown> = {}) {
  return {
    goalMode: "standard",
    stage: { owner: "system", kind: "working" },
    progress: { total: 3, done: 1, inProgress: 1, review: 0, failed: 0, skipped: 1 },
    lastError: null,
    accepted: false,
    ...overrides,
  } as any
}

test("standard goals use level three and quick goals use level four", () => {
  const standard = agentContractFor(goal())
  assert.equal(standard.level, 3)
  assert.equal(standard.levelLabel, "批准后执行")
  assert.match(standard.discretion, /计划内自主/)

  const quick = agentContractFor(goal({ goalMode: "quick" }))
  assert.equal(quick.level, 4)
  assert.equal(quick.levelLabel, "授权内自主")
  assert.match(quick.discretion, /可逆、低风险/)

  const standing = agentContractFor(goal({ goalMode: "standing" }))
  assert.equal(standing.level, 4)
})

test("human-only boundaries are always present", () => {
  const contract = agentContractFor(goal())
  assert.deepEqual(contract.humanOnly, ["验收", "合并", "解决评审项", "5 自决永远不允许"])
  assert.equal(contract.escalation.includes("验收"), true)
  assert.equal(contract.audit.includes("决定记录"), true)
})
