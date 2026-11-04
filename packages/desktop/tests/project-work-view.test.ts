import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const view = read("src/renderer/mafw/components/ProjectWorkView.tsx")
const pane = read("src/renderer/mafw/components/ChatPane.tsx")
const podDock = read("src/renderer/mafw/components/PodDock.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("ProjectWorkView owns the project work overview and Goal composer", () => {
  assert.match(view, /import \{ WorkOverview \} from "\.\/WorkOverview"/)
  assert.match(view, /import \{ PodGoalComposer \} from "\.\/PodGoalComposer"/)
  assert.match(view, /window\.api\.mafw\.work\.overview\(/)
  assert.match(view, /window\.api\.mafw\.pod\.ensure\(/)
  assert.match(view, /window\.api\.mafw\.pod\.createGoal\(/)
  assert.match(view, /refreshTick:/)
  assert.match(view, /composerRequest \?\? 0/)
  assert.doesNotMatch(view, /WorkspaceHome/)
})

test("ProjectWorkView polls only while active and consumes each composer request once", () => {
  assert.match(view, /active: boolean/)
  assert.match(view, /let lastConsumedComposerRequest = 0/)
  assert.match(view, /if \(!props\.active\) return/)
  assert.match(view, /if \(request > lastConsumedComposerRequest && props\.active\) \{/)
  assert.match(view, /lastConsumedComposerRequest = request/)
  assert.match(shell, /active=\{dockPresent\(\) && workbenchView\(\) === "work"\}/)
})

test("the shell mounts ProjectWorkView in the work L1 pane", () => {
  assert.match(shell, /import \{ ProjectWorkView \} from "\.\/components\/ProjectWorkView"/)
  assert.match(shell, /workView=\{\s*<ProjectWorkView/)
  assert.match(shell, /refreshTick=\{\(\) => Math\.max\(goalsRev\(\), podStore\.revision\(\)\)\}/)
  assert.match(shell, /composerRequest=\{goalComposerRequest\(\)\}/)
})

test("friendlyWorkError only maps explicit no-Pod errors", () => {
  assert.match(view, /if \(\/pod not found\|没有鲸群\|no pod\/i\.test\(text\)\)/)
  assert.doesNotMatch(view, /\/404\|/)
})

test("the /goals command and PodDock point at the right workbench", () => {
  assert.match(pane, /id: "goals", trigger: "\/goals", title: "项目工作", description: "在右工作台打开项目工作"/)
  assert.match(podDock, /从右工作台「工作」向 Lead 交代工作/)
  assert.doesNotMatch(podDock, /从工作空间向 Lead 交代工作/)
})
