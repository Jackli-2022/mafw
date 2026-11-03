import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const rail = readFileSync(new URL("../src/renderer/mafw/components/IconRail.tsx", import.meta.url), "utf8")
const icons = readFileSync(new URL("../../ui/src/components/icon.tsx", import.meta.url), "utf8")

test("rail exposes the pod destination with a badge in its accessible name", () => {
  assert.match(rail, /"pod"/)
  assert.match(rail, /team-three/)
  assert.match(rail, /podBadge/)
  assert.match(rail, /formatRailBadge/)
  assert.match(rail, /badgeLabel/)
  assert.match(rail, /railAriaLabel/)
  assert.match(rail, /value=\{railAriaLabel\(/)
  assert.match(icons, /"team-three":/)
})

test("rail names the free-discussion face and the resource face truthfully", () => {
  assert.match(rail, /\"讨论 \(Ctrl\+B\)\"/)
  assert.match(rail, /"资源"/)
  assert.match(rail, /"工作空间"/)
  assert.doesNotMatch(rail, /label: "Dashboard"/)
  assert.doesNotMatch(rail, /label: "工作 \(Ctrl\+B\)"/)
})

test("left dock renders ProjectResources on the resource face", () => {
  const dock = readFileSync(new URL("../src/renderer/mafw/components/LeftDock.tsx", import.meta.url), "utf8")
  assert.match(dock, /import \{ ProjectResources \}/)
  assert.match(dock, /<ProjectResources/)
  assert.doesNotMatch(dock, /PodRailFace/)
})
