// Task 19 接线契约：Lead 是唯一可见的协调入口，命中隐藏在 /api/sessions 之外。
//
// 组件是 Solid JSX；行为/纯逻辑在 pod-tech-lead-invite.test.ts，这里只按 house 先例
// （lead-coordinator-wiring 等）锁源码接线，防后续重构把固定入口删掉。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const leftDock = read("../src/renderer/mafw/components/LeftDock.tsx")
const managerCard = read("../src/renderer/mafw/components/ManagerCard.tsx")
const welcome = read("../src/renderer/mafw/components/WelcomeHome.tsx")
const chatPane = read("../src/renderer/mafw/components/ChatPane.tsx")

test("LeftDock 的 Lead 入口是固定的：隐藏会话不在列表里也照样渲染", () => {
  // 固定入口 = ManagerCard（kv managerSessionId 兜底，不依赖 session-tree 的 manager 行）
  assert.match(leftDock, /<ManagerCard/)
  assert.match(leftDock, /managerSessionId=\{managerRow\(\)\?\.id \?\? props\.managerSessionId \?\? null\}/)
})

test("Lead 入口的实际文案由 ManagerCard 渲染（工厂名不影响用户可见文案）", () => {
  // 组件文件名保留历史名（kv/API 兼容），但渲染的必须是 Lead
  assert.match(managerCard, /<span class="mafw-manager-row-name">Lead<\/span>/)
  assert.match(managerCard, /onSelectSession\(props\.managerSessionId, "Lead", true, \{ mafw: \{ role: "lead" \} \}\)/)
  assert.doesNotMatch(managerCard, />Manager</)
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
