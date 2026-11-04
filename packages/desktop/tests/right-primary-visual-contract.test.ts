// 右主工作台视觉契约（2026-11-04）：工作 / 项目资源 / Goal 详情沿用「编辑台式」
// 层级——状态点、计数、chips、头像、chevron，而不是一排大空卡。
// 替代退役的 workspace-polish-style.test.ts（WorkspaceHome 已随全页工作空间退役）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const css = read("../src/renderer/mafw/mafw.css")
const work = read("../src/renderer/mafw/components/ProjectWorkView.tsx")
const overview = read("../src/renderer/mafw/components/WorkOverview.tsx")
const resources = read("../src/renderer/mafw/components/ProjectResources.tsx")
const detail = read("../src/renderer/mafw/components/GoalDetailOverlay.tsx")

test("工作概览：分组有状态点/计数，Goal 行有可读元信息 chips", () => {
  assert.match(overview, /mafw-work-status-dot/)
  assert.match(overview, /mafw-work-group-count/)
  assert.match(overview, /mafw-work-chip/)
  assert.match(overview, /podStageLabel/)
  assert.match(css, /\.mafw-work-status-dot \{[^}]*width: 6px;[^}]*border-radius: 50%/)
  assert.match(css, /\.mafw-work-chip \{[^}]*border-radius: 4px;[^}]*font-family: var\(--font-data\)/)
})

test("项目资源：行有图标/头像/chevron，扫读不再只有文字", () => {
  assert.match(resources, /mafw-resource-avatar/)
  assert.match(resources, /name="team-three"/)
  assert.match(resources, /mafw-resources-chevron/)
  assert.match(resources, /mafw-resources-row/)
  assert.match(css, /\.mafw-resource-avatar \{[^}]*width: 22px;[^}]*border-radius: 50%/)
  assert.match(css, /\.mafw-resources-chevron \{[^}]*opacity: 0;[^}]*var\(--dur-fast\)/)
})

test("Goal 详情：头部/状态/区块统一为卡片层级", () => {
  assert.match(detail, /mafw-goal-head-main/)
  assert.match(detail, /mafw-goal-chip/)
  assert.match(css, /\.mafw-goal-head-main \.mafw-card-title \{[^}]*font-size: 22px/)
  assert.match(css, /\.mafw-goal-chip \{[^}]*border-radius: 999px/)
  assert.match(css, /\.mafw-goal-section \{[^}]*border-radius: var\(--r-lg\);[^}]*background: var\(--bg-raised\)/)
})

test("右工作台「工作」面：kicker/提示/composer 有独立结构", () => {
  assert.match(work, /mafw-project-work/)
  assert.match(work, /mafw-work-kicker/)
  assert.match(work, /mafw-project-work-hint/)
  assert.match(work, /mafw-project-work-composer/)
  assert.match(css, /\.mafw-project-work \{/)
  assert.match(css, /\.mafw-project-work-hint \{/)
  assert.match(css, /\.mafw-project-work-composer \{/)
})

test("动效尊重 reduced-motion，且复用既有 token", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /\.mafw-resources-chevron \{[^}]*var\(--dur-fast\)/)
})
