import { test } from "node:test"
import assert from "node:assert/strict"
import { dataPartView, isDataPartType } from "./data-part-model"

test("isDataPartType accepts data-<name> only", () => {
  assert.equal(isDataPartType("data-swarm"), true)
  assert.equal(isDataPartType("data-a_b-1"), true)
  assert.equal(isDataPartType("data-"), false)
  assert.equal(isDataPartType("data-UPPER"), false)
  assert.equal(isDataPartType("tool"), false)
})

test("dataPartView extracts name and pretty JSON", () => {
  const view = dataPartView({ type: "data-swarm", data: { done: 2, total: 3 } })
  assert.equal(view.name, "swarm")
  assert.equal(view.empty, false)
  assert.match(view.json, /"done": 2/)
})

test("dataPartView marks empty and unserializable payloads", () => {
  assert.equal(dataPartView({ type: "data-x", data: undefined }).empty, true)
  const cyclic: any = {}
  cyclic.self = cyclic
  const view = dataPartView({ type: "data-x", data: cyclic })
  assert.equal(view.json, "[unserializable]")
})

test("dataPartView truncates beyond 8KB", () => {
  const view = dataPartView({ type: "data-x", data: { big: "y".repeat(10_000) } })
  assert.equal(view.truncated, true)
  assert.ok(view.json.length < 8_300)
  assert.match(view.json, /…$/)
})
