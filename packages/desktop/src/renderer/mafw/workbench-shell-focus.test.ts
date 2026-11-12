import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const shell = read("components/WorkbenchShell.tsx")
const stage = read("components/FocusStage.tsx")
const plugin = read("components/PluginSurfaceStage.tsx")

test("WorkbenchShell is focus-only", () => {
  assert.match(shell, /FocusStage/)
  assert.match(shell, /FrameBar/)
  assert.match(shell, /LensBar/)
  assert.match(shell, /SubjectPicker/)
  for (const legacy of [
    "WorkbenchContext",
    "ContentScopeHeader",
    "WorkbenchCodeView",
    "ExecutionView",
    "mafw-rw-l2",
    "mafw-rw-exec-drawer",
    "onExecutionOpen",
    "contentSplit",
  ]) {
    assert.doesNotMatch(shell, new RegExp(legacy))
  }
})

test("FocusStage dispatches world, goal, changeSet and plugin", () => {
  assert.match(stage, /kind\(\) === "world"/)
  assert.match(stage, /kind\(\) === "goal"/)
  assert.match(stage, /kind\(\) === "changeSet"/)
  assert.match(stage, /kind\(\) === "plugin"/)
  assert.match(stage, /PluginSurfaceStage|renderPluginSurface/)
})

test("PluginSurfaceStage keeps visited web surfaces mounted", () => {
  assert.match(plugin, /PluginWebSurfaceHost/)
  assert.match(plugin, /visited/)
  assert.match(plugin, /display/)
})
