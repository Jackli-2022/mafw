import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell uses width for left dock mode", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /resolveMode\(leftDock\(\)\.open,\s*viewportWidth\(\)\)/)
  assert.doesNotMatch(src, /resolveMode\(leftDock\(\)\.open,\s*winMaximized\(\)\)/)
  assert.match(src, /restoreLeftDockOpen\(/)
  assert.match(src, /effectiveLeftDockWidth\(/)
  assert.match(src, /shouldAutoRestoreLeftDock\(/)
})
