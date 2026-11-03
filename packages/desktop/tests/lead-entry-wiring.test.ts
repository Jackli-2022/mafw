// Task 19 接线契约：Lead 是唯一可见的协调入口，命中隐藏在 /api/sessions 之外。
//
// 组件是 Solid JSX；行为/纯逻辑在 pod-tech-lead-invite.test.ts，这里只按 house 先例
// （lead-coordinator-wiring 等）锁源码接线，防后续重构把固定入口删掉。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const leftDock = read("../src/renderer/mafw/components/LeftDock.tsx")
const css = read("../src/renderer/mafw/mafw.css")
const welcome = read("../src/renderer/mafw/components/WelcomeHome.tsx")
const chatPane = read("../src/renderer/mafw/components/ChatPane.tsx")
const workspaceHome = read("../src/renderer/mafw/components/WorkspaceHome.tsx")
const workOverview = read("../src/renderer/mafw/components/WorkOverview.tsx")

test("工作 rail 不再渲染固定 Lead/Manager 入口", () => {
  assert.doesNotMatch(leftDock, /<ManagerCard/)
  assert.doesNotMatch(leftDock, /mafw-manager-row/)
  assert.doesNotMatch(css, /\.mafw-manager-row/)
})

test("WelcomeHome 的入口收敛到鲸群与 Pod composer，不再内联创建 Goal", () => {
  assert.match(welcome, />Lead 会话</)
  assert.match(welcome, /onOpenLead/)
  assert.match(welcome, /onOpenGoalComposer/)
  assert.doesNotMatch(welcome, />Manager</)
  assert.doesNotMatch(welcome, /goalDraft|goalInputOpen|planReview|submitGoal|onNewGoal/)
})

test("工作空间空态使用 Lead 文案", () => {
  assert.match(workOverview, /向 Lead 交代一件事/)
  assert.match(workspaceHome, /把工作交代给 Lead/)
  assert.doesNotMatch(workOverview, /让 Manager 为你编排/)
})

test("ChatPane 不再向用户暴露 Manager 文案（slash 命令描述也改 Lead）", () => {
  assert.match(chatPane, /leadEntryLabel\(\)/)
  assert.doesNotMatch(chatPane, /提交 Goal 给 Manager/)
  assert.doesNotMatch(chatPane, /当前 Manager 会话归档/)
  assert.doesNotMatch(chatPane, /mafw-new-topic|onNewTopic/)
})
