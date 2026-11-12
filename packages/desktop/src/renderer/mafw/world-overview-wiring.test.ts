import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")
const stage = read("components/WorldOverviewStage.tsx")
const shell = read("MafwShell.tsx")

test("WorldOverviewStage keeps world actions and drops file cards", () => {
  assert.match(stage, /WorkPriorityList/)
  assert.match(stage, /StandingGoalsPanel/)
  assert.match(stage, /ProjectTeamStrip/)
  assert.match(stage, /WorkOverview/)
  assert.match(stage, /新建 Goal/)
  assert.match(stage, /世界总览/)
  assert.doesNotMatch(stage, /ProjectFilesCard|RecentContentList|项目文件|最近内容/)
})

test("MafwShell renders the world stage for world focus", () => {
  assert.match(shell, /WorldOverviewStage/)
  assert.match(shell, /workView=/)
})
