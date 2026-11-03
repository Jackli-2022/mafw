import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const view = read("src/renderer/mafw/components/ProjectWorkView.tsx")
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

test("the shell mounts ProjectWorkView in the work L1 pane", () => {
  assert.match(shell, /import \{ ProjectWorkView \} from "\.\/components\/ProjectWorkView"/)
  assert.match(shell, /workView=\{\s*<ProjectWorkView/)
  assert.match(shell, /refreshTick=\{\(\) => Math\.max\(goalsRev\(\), podStore\.revision\(\)\)\}/)
  assert.match(shell, /composerRequest=\{goalComposerRequest\(\)\}/)
})
