import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDelegationPreview } from "./delegation-preview"

const base = {
  projectName: "opencode-plugin-mafw",
  title: "收敛工作台",
  objective: "让 Chat 负责决定、Workbench 负责证明",
  acceptance: ["npm test 全绿", "评审项全部解决"],
  boundaries: ["不改权限门禁"],
  planReview: "manual" as const,
}

test("preview contains all twelve delegation fields", () => {
  const preview = buildDelegationPreview(base)
  for (const key of [
    "principal", "agent", "scope", "intent", "constraints", "acceptance",
    "discretion", "escalation", "budget", "evidence", "termination", "audit",
  ] as const) {
    assert.equal(typeof preview[key], "string")
    assert.ok(preview[key].length > 0, `${key} is empty`)
  }
})

test("empty acceptance and boundaries are explicit", () => {
  const preview = buildDelegationPreview({
    ...base,
    acceptance: [],
    boundaries: [],
  })
  assert.match(preview.constraints, /未声明/)
  assert.match(preview.constraints, /计划批准时确认/)
  assert.match(preview.acceptance, /计划批准时确认/)
})

test("autonomy is level three and never five", () => {
  const preview = buildDelegationPreview(base)
  assert.equal(preview.autonomy.level, 3)
  assert.equal(preview.autonomy.label, "批准后执行")
  assert.match(preview.autonomy.note, /验收、合并/)
  assert.match(preview.autonomy.note, /永远由人完成/)
})
