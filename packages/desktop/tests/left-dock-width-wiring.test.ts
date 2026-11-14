import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell uses the layout container width for left dock mode", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /resolveMode\(\s*leftDock\(\)\.open,\s*viewportWidth\(\),\s*leftDockWidth\(\),\s*leftDockRequiredMainWidth\(\),\s*lastLeftDockMode\s*\)/)
  assert.doesNotMatch(src, /resolveMode\(leftDock\(\)\.open,\s*winMaximized\(\)\)/)
  assert.match(src, /new ResizeObserver/)
  assert.match(src, /bodyEl = el/)
  assert.match(src, /setViewportWidth\(el\.clientWidth\)/)
  assert.doesNotMatch(src, /setViewportWidth\(window\.innerWidth\)/)
  assert.match(src, /restoreLeftDockOpen\(/)
  assert.match(src, /effectiveLeftDockWidth\(/)
  assert.match(src, /shouldAutoRestoreLeftDock\(/)
})

test("left dock mode has 12px hysteresis", () => {
  const dock = read("src/renderer/mafw/left-dock.ts")
  assert.match(dock, /PUSH_HYSTERESIS = 12/)
  assert.match(dock, /previousMode === "push" \? -PUSH_HYSTERESIS : previousMode === "overlay" \? PUSH_HYSTERESIS : 0/)
  assert.match(dock, /leftDockPushBudget\(dockWidth, requiredMainWidth\) \+ PUSH_HYSTERESIS/)
})

test("narrow two-view mode evaluates push per visible column", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /const narrowZone = \(\) => workbenchZoneFor\(viewportWidth\(\) - LEFT_RAIL_WIDTH\)/)
  assert.match(src, /narrowView\(\) === "workbench" \? WORKBENCH_MIN_WIDTH : CHAT_COMFORT_MIN/)
  assert.match(src, /const leftDockRequiredMainWidth = \(\) => narrowZone\(\) \? narrowRequiredMainWidth\(\) : PUSH_PAIR_BUDGET/)
})

test("push budget is the single truth (no legacy 1366 constant)", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const dock = read("src/renderer/mafw/left-dock.ts")
  const leftDock = read("src/renderer/mafw/components/LeftDock.tsx")
  assert.match(shell, /resizeMax=\{leftDockPushDragMax\(viewportWidth\(\), leftDockRequiredMainWidth\(\)\)\}/)
  assert.match(leftDock, /props\.resizeMax \?\? 400/)
  assert.match(dock, /leftDockPushBudget\(dockWidth, requiredMainWidth\)/)
  assert.doesNotMatch(dock, /LEFT_DOCK_PUSH_MIN_WIDTH/)
  assert.doesNotMatch(shell, /LEFT_DOCK_PUSH_MIN_WIDTH/)
})
