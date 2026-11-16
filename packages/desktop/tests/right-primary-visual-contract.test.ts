// 右主工作台视觉契约（2026-11-04）：工作 / 项目资源 / Goal 详情沿用「编辑台式」
// 层级——状态点、计数、chips、头像、chevron，而不是一排大空卡。
// 替代退役的 workspace-polish-style.test.ts（WorkspaceHome 已随全页工作空间退役）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const css = read("../src/renderer/mafw/mafw.css")
const work = read("../src/renderer/mafw/components/WorldOverviewStage.tsx")
const overview = read("../src/renderer/mafw/components/WorkOverview.tsx")
const resources = read("../src/renderer/mafw/components/ProjectTeamStrip.tsx")
const detail = read("../src/renderer/mafw/components/GoalDetailPanel.tsx")

test("工作列表先给阶段与真实进度，而不是工程 chips", () => {
  assert.match(overview, /summary\.statusLabel/)
  assert.match(overview, /summary\.progressText/)
  assert.match(overview, /mafw-work-item-progress/)
  assert.doesNotMatch(overview, /mafw-work-status-dot/)
  assert.doesNotMatch(overview, /goalChips/)
  assert.match(css, /\.mafw-work-chip \{[^}]*border-radius: 4px;[^}]*font-family: var\(--font-data\)/)
})

test("工作项是内容撑高的多行行，不被 ButtonV2 small 的 24px 固定高度裁切", () => {
  // ButtonV2[data-size="small"] 固定 height:24px；工作项是「标题 + 可换行 chips」两段式，
  // 必须显式放开高度：否则 hover 背景只覆盖 24px，溢出文字压到下一行/下一组（2026-11-05 实证）。
  const item = css.match(/\.mafw-shell \.mafw-work-item\[data-size="small"\] \{([^}]*)\}/)?.[1]
  assert.ok(item, "缺少工作项高度放开规则")
  assert.match(item, /height: auto/)
  assert.match(item, /min-height: 30px/)
})

test("团队条：头像/状态/资源动作，团队细节进执行抽屉", () => {
  assert.match(resources, /mafw-pod-contact-avatar/)
  assert.match(resources, /name="team-three"/)
  assert.match(resources, /mafw-project-team-actions/)
  assert.match(resources, /mafw-project-team-chip/)
  assert.match(resources, /创建团队/)
})

test("Goal 详情：头部/状态/区块统一为编辑台式层级", () => {
  assert.match(detail, /mafw-goal-head-main/)
  assert.match(detail, /mafw-goal-chip/)
  assert.match(css, /\.mafw-goal-head-main \.mafw-card-title \{[^}]*font-size: 22px/)
  assert.match(css, /\.mafw-goal-chip \{[^}]*border-radius: 999px/)
  // 2026-11-16 Precision Instrument：区块分隔靠一条 hairline，不再每块套卡片。
  assert.match(css, /\.mafw-goal-section \{[^}]*border-top: 1px solid var\(--border-subtle\);/)
  assert.doesNotMatch(css, /\.mafw-goal-section \{[^}]*border: 1px solid var\(--border-subtle\)/)
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
