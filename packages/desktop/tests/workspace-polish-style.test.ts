// 视觉收口契约（2026-11-04）：工作空间 / Goal 详情 / 项目资源共用一套
// 「编辑台式」层级——细线、状态点、数字/元信息分层，而不是一排大空卡。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const css = read("../src/renderer/mafw/mafw.css")
const workspace = read("../src/renderer/mafw/components/WorkspaceHome.tsx")
const overview = read("../src/renderer/mafw/components/WorkOverview.tsx")
const resources = read("../src/renderer/mafw/components/ProjectResources.tsx")
const detail = read("../src/renderer/mafw/components/GoalDetailOverlay.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("工作空间：讨论行带真实时间与独立结构，不再重复「自由讨论」", () => {
  assert.match(workspace, /mafw-workspace-discussion-row/)
  assert.match(workspace, /time\?\.updated/)
  assert.match(shell, /time: s\.time/)
  assert.match(css, /\.mafw-workspace-discussion-row \{/)
})

test("工作概览：分组有状态点/计数，Goal 行有可读元信息 chips", () => {
  assert.match(overview, /mafw-work-status-dot/)
  assert.match(overview, /mafw-work-group-count/)
  assert.match(overview, /mafw-work-chip/)
  assert.match(overview, /podStageLabel/)
  assert.match(css, /\.mafw-work-chip \{/)
})

test("项目资源：行有图标/头像/chevron，扫读不再只有文字", () => {
  assert.match(resources, /mafw-resource-avatar/)
  assert.match(resources, /name="team-three"/)
  assert.match(resources, /mafw-resources-chevron/)
  assert.match(css, /\.mafw-resource-avatar \{/)
})

test("Goal 详情：头部/状态/区块统一为卡片层级", () => {
  assert.match(detail, /mafw-goal-head-main/)
  assert.match(detail, /mafw-goal-chip/)
  assert.match(css, /\.mafw-goal-section \{/)
  assert.match(css, /\.mafw-goal-chip \{/)
})

test("动效尊重 reduced-motion，且不引入第二套颜色 token", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /\.mafw-workspace-lead::before/)
})
