import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MessageNav normalizes the turns accessor before reading length", () => {
  const src = read("src/renderer/mafw/components/MessageNav.tsx")
  assert.match(src, /normalizeMessageNavTurns/)
  assert.match(src, /createMemo/)
  assert.doesNotMatch(src, /props\.turns\(\)\.length/)
})
