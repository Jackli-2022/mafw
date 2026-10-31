import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const shell = readFileSync(new URL("../src/renderer/mafw/MafwShell.tsx", import.meta.url), "utf8")
const dock = readFileSync(new URL("../src/renderer/mafw/components/PodDock.tsx", import.meta.url), "utf8")

test("shell owns the pod subscription and feeds the rail badge", () => {
  assert.match(shell, /podRailBadge\(/)
  assert.match(shell, /podBadge=\{/)
  assert.match(shell, /podStore\.open\(/)
  assert.match(shell, /onPodOpenPanel/)
  assert.match(shell, /notify: input\.notify/)
  assert.match(shell, /deliveryToast/)
  assert.match(shell, /setActiveTab\("chat"\)/)
  assert.match(shell, /panel === "inbox"/)
  assert.doesNotMatch(shell, /void panel/)
})

test("right workbench no longer owns the first pod load", () => {
  assert.match(dock, /if \(!props\.active\) return[\s\S]{0,160}podStore\.refresh\(\)/)
})
