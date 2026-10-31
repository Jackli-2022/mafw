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
