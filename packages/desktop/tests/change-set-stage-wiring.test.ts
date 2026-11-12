import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const stage = read("src/renderer/mafw/components/ChangeSetStage.tsx")
const focus = read("src/renderer/mafw/components/FocusStage.tsx")
const workbench = read("src/renderer/mafw/components/WorkbenchShell.tsx")

test("ChangeSetStage reuses ChangesDock and has an explicit empty state", () => {
  assert.match(stage, /ChangesDock/)
  assert.match(stage, /DockEmpty/)
  assert.match(stage, /这个 revision 还没有变更/)
  assert.match(stage, /mafw-change-set-stage/)
})

test("FocusStage dispatches the changeSet branch to ChangeSetStage", () => {
  assert.match(focus, /ChangeSetStage/)
  assert.match(focus, /kind\(\) === "changeSet"/)
  assert.doesNotMatch(focus, /变更集舞台待接入/)
})

test("WorkbenchShell passes diffs and session directory to the stage", () => {
  assert.match(workbench, /sessionDirectory=/)
  assert.match(workbench, /diffs=\{props\.diffs\}/)
})
