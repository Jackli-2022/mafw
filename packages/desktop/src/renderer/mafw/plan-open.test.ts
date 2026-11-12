import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldOpenPlan } from "./plan-open"

test("plan open nonce is scoped to its goal", () => {
  const request = { nonce: 2, goalId: "g1" }
  assert.equal(shouldOpenPlan(request, "g1", 1), true)
  assert.equal(shouldOpenPlan(request, "g2", 1), false)
})

test("plan open does not replay the same nonce", () => {
  const request = { nonce: 2, goalId: "g1" }
  assert.equal(shouldOpenPlan(request, "g1", 2), false)
  assert.equal(shouldOpenPlan(null, "g1", 0), false)
})
