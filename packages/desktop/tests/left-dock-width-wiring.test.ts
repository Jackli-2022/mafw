import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell uses width for left dock mode", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /resolveMode\(leftDock\(\)\.open,\s*viewportWidth\(\),\s*leftDockWidth\(\)\)/)
  assert.doesNotMatch(src, /resolveMode\(leftDock\(\)\.open,\s*winMaximized\(\)\)/)
  assert.match(src, /restoreLeftDockOpen\(/)
  assert.match(src, /effectiveLeftDockWidth\(/)
  assert.match(src, /shouldAutoRestoreLeftDock\(/)
})

test("50:50 push budget is the single truth (no legacy 1366 constant)", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const dock = read("src/renderer/mafw/left-dock.ts")
  const leftDock = read("src/renderer/mafw/components/LeftDock.tsx")
  assert.match(shell, /leftDockPushDragMax\(viewportWidth\(\)\)/)
  assert.match(shell, /resizeMax=\{leftDockPushDragMax/)
  assert.match(leftDock, /props\.resizeMax \?\? 400/)
  assert.match(dock, /leftDockPushBudget\(dockWidth\)/)
  assert.doesNotMatch(dock, /LEFT_DOCK_PUSH_MIN_WIDTH/)
  assert.doesNotMatch(shell, /LEFT_DOCK_PUSH_MIN_WIDTH/)
})
