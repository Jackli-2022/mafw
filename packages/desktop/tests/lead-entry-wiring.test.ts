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

test("工作 rail 不再渲染固定 Lead/Manager 入口", () => {
  assert.doesNotMatch(leftDock, /<ManagerCard/)
  assert.doesNotMatch(leftDock, /mafw-manager-row/)
  assert.doesNotMatch(css, /\.mafw-manager-row/)
})

test("WelcomeHome 的协调入口用 Lead 文案", () => {
  // 既有契约 lead-coordinator-wiring 继续钉字面量；Manager 文案不得回归
  assert.match(welcome, />Lead 会话</)
  assert.doesNotMatch(welcome, />Manager</)
})

test("ChatPane 不再向用户暴露 Manager 文案（slash 命令描述也改 Lead）", () => {
  assert.match(chatPane, /leadEntryLabel\(\)/)
  assert.doesNotMatch(chatPane, /提交 Goal 给 Manager/)
  assert.doesNotMatch(chatPane, /当前 Manager 会话归档/)
})
