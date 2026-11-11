import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_CONTENT_HISTORY,
  popContentHistory,
  pushContentHistory,
  type ContentHistoryEntry,
} from "./content-history"

const project = { kind: "project", projectDir: "C:\\work\\app" } as const

test("history pushes, pops and dedupes the same consecutive location", () => {
  const first = { scope: project, rel: "src/a.ts", label: "项目文件" }
  const second = { scope: project, rel: "src/b.ts", label: "项目文件" }
  let history = pushContentHistory([], first)
  history = pushContentHistory(history, first)
  assert.equal(history.length, 1)
  history = pushContentHistory(history, second)
  const popped = popContentHistory(history)
  assert.equal(popped.entry?.rel, "src/b.ts")
  assert.deepEqual(popped.rest, [first])
})

test("empty history pops to null and depth is capped", () => {
  assert.deepEqual(popContentHistory([]), { entry: null, rest: [] })
  let history: ContentHistoryEntry[] = []
  for (let i = 0; i < MAX_CONTENT_HISTORY + 5; i += 1) {
    history = pushContentHistory(history, { scope: project, rel: `f${i}.ts`, label: "项目文件" })
  }
  assert.equal(history.length, MAX_CONTENT_HISTORY)
  assert.equal(history[0].rel, "f5.ts")
})
