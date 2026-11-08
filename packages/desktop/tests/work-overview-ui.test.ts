import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const priority = read("src/renderer/mafw/components/WorkPriorityList.tsx")
const overview = read("src/renderer/mafw/components/WorkOverview.tsx")

test("priority cards appear only when there is something to show", () => {
  assert.match(priority, /Show when=\{props\.items\.length > 0\}/)
  assert.match(priority, /现在需要关注/)
  assert.match(priority, /新结果/)
  assert.match(priority, /等待你处理/)
})

test("each priority card has one direct human action", () => {
  assert.match(priority, /item\.kind === "attention" \? item\.label : "查看结果"/)
  assert.match(priority, /props\.onOpen\(item\.goal, priorityFocus\(item\)\)/)
  assert.match(priority, /item\.kind === "result" \? "result"/)
  assert.match(priority, /attentionTarget\(item\.kind === "attention" && item\.actionType \? \{ type: item\.actionType \} : undefined\)/)
})

test("the full Goal list owns the four filters and stable row identity", () => {
  assert.match(overview, /For each=\{WORK_FILTERS\}/)
  assert.match(overview, /全部 Goal/)
  assert.match(overview, /data-goal-id=\{goal\.goalId\}/)
  assert.match(overview, /filterWorkGoals\(props\.goals, props\.filter\)/)
  assert.match(overview, /workFilterCounts\(props\.goals\)/)
})

test("Goal rows lead with stage and real progress instead of engineering metadata", () => {
  assert.match(overview, /podStageLabel\(goal\.stage\)/)
  assert.match(overview, /goalProgressText\(goal\)/)
  assert.match(overview, /goal\.bucket === "result_ready" && props\.isViewed && !props\.isViewed\(goal\)/)
  assert.doesNotMatch(overview, /工作概览/)
  assert.doesNotMatch(overview, /全部历史/)
  assert.doesNotMatch(overview, /goalChips/)
  assert.doesNotMatch(overview, /rev \$\{/)
  assert.doesNotMatch(overview, /onOpenAll/)
})
