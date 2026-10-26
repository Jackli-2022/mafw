import { test, expect } from "bun:test"
import { dataPartView, isDataPartType } from "./data-part-model"

test("isDataPartType accepts data-<name> only", () => {
  expect(isDataPartType("data-swarm")).toBe(true)
  expect(isDataPartType("data-a_b-1")).toBe(true)
  expect(isDataPartType("data-")).toBe(false)
  expect(isDataPartType("data-UPPER")).toBe(false)
  expect(isDataPartType("tool")).toBe(false)
})

test("dataPartView extracts name and pretty JSON", () => {
  const view = dataPartView({ type: "data-swarm", data: { done: 2, total: 3 } })
  expect(view.name).toBe("swarm")
  expect(view.empty).toBe(false)
  expect(view.json).toContain('"done": 2')
})

test("dataPartView marks empty and unserializable payloads", () => {
  expect(dataPartView({ type: "data-x", data: undefined }).empty).toBe(true)
  const cyclic: any = {}
  cyclic.self = cyclic
  expect(dataPartView({ type: "data-x", data: cyclic }).json).toBe("[unserializable]")
})

test("dataPartView truncates beyond 8KB", () => {
  const view = dataPartView({ type: "data-x", data: { big: "y".repeat(10_000) } })
  expect(view.truncated).toBe(true)
  expect(view.json.length < 8_300).toBe(true)
  expect(view.json.endsWith("…")).toBe(true)
})
