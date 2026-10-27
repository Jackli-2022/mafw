import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("ui icon table carries the two new rail icons", () => {
  const src = read("../ui/src/components/icon.tsx")
  assert.match(src, /"sticky-note":\s*`/)
  assert.match(src, /"layout-grid":\s*`/)
  // 20-grid 家族：stroke currentColor
  const note = src.match(/"sticky-note":\s*`([^`]+)`/)?.[1] ?? ""
  const grid = src.match(/"layout-grid":\s*`([^`]+)`/)?.[1] ?? ""
  assert.match(note, /stroke="currentColor"/)
  assert.match(grid, /stroke="currentColor"/)
  assert.equal((grid.match(/<rect/g) ?? []).length, 4)
})

test("sessions keeps bubble-5 (already a clean bubble; no duplicate chat icon)", () => {
  const src = read("../ui/src/components/icon.tsx")
  assert.match(src, /"bubble-5":\s*`/)
  assert.doesNotMatch(src, /"?chat"?:\s*`/)
})
