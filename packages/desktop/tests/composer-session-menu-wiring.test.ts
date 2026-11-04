// 契约：composer 收敛为「会话配置单菜单」（spec 2026-11-04-inputbar-rail-attention-redesign-design.md §3.1）。
// 组件是 Solid JSX，渲染代价高，接线层面用源码断言（与 icon-rail/lead-coordinator 同先例）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const pane = read("../src/renderer/mafw/components/ChatPane.tsx")
const css = read("../src/renderer/mafw/mafw.css")

test("会话配置 pill + popover 接线（默认标签 = 模型名）", () => {
  assert.ok(pane.includes("SessionConfigMenu"))
  assert.ok(pane.includes("mafw-composer-session-pill"))
  assert.ok(pane.includes('setPickerOpen("session-config")'))
  assert.ok(pane.includes("agentBadge("))
  assert.ok(pane.includes("thinkingBadge("))
  // 菜单 id → entry 查找必须走大小写不敏感解析（view DTO id 可能是 Build/Plan）。
  assert.ok(pane.includes("findAgentEntry("))
})

test("agent pill / plan-build pill / 命令与引用按钮移除；键盘能力保留", () => {
  assert.ok(!pane.includes("mafw-composer-agent-pill"), "agent pill 应删除")
  assert.ok(!pane.includes("切换 Agent"), "more menu 的切换 Agent 应删除")
  assert.ok(!pane.includes('aria-label="命令"'), "命令按钮应删除")
  assert.ok(!pane.includes('aria-label="引用 Agent"'), "引用按钮应删除")
  // Tab agent 循环保留，但选项来自 MafwAgent DTO（不认 runtime 原生 plan/build）。
  assert.ok(pane.includes("agentMenuOptions("), "Agent 选项必须从 DTO 派生")
  assert.ok(pane.includes("nextRuntimeAgent("), "Tab 循环必须走契约模型")
  assert.ok(pane.includes("agentCycleGate"))
  assert.ok(!pane.includes("AGENT_SWITCH_OPTIONS"), "前端不得硬编码 plan/build 选项")
  assert.ok(!/isAgentKey\([^)]*"(?:plan|build)"/.test(pane), "前端不得按 runtime agent 名分支")
})

test("附件/截屏/引用收进 ＋ 菜单；审阅/播报/暂停在 ⋯ 菜单", () => {
  assert.ok(pane.includes("mafw-composer-attach"))
  assert.ok(pane.includes("mafw-composer-attach-menu"))
  assert.ok(pane.includes("审阅改动"))
  assert.ok(pane.includes("语音播报"))
  assert.ok(pane.includes("暂停回合"))
})

test("占位符教学并入输入框；keyhint 浮层删除", () => {
  assert.ok(pane.includes("输入消息…（/ 命令 · @ 引用）"))
  assert.ok(!pane.includes("mafw-keyhint"))
})

test("Lead / creator 会话锁定迁移到会话菜单 Agent 行", () => {
  assert.ok(pane.includes("agentLocked={isLead() || creatorLocked()}"))
  assert.ok(pane.includes('isAgentKey(props.agentSel(), "mafw-create")'))
  assert.ok(pane.includes('=== "mafw-create"'), "session.agent 为 mafw-create 时也要锁定")
})

test("窄窗档位：≤620 藏上下文 pill，≤520 藏 ＋（附件入口仍在 ⋯）", () => {
  assert.match(css, /@container \(max-width: 620px\)[\s\S]*?\.mafw-context-pill \{ display: none/)
  assert.match(css, /@container \(max-width: 520px\)[\s\S]*?\.mafw-composer-attach \{ display: none/)
})
