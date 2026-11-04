import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const resources = read("src/renderer/mafw/components/ProjectResources.tsx")
const leftDock = read("src/renderer/mafw/components/LeftDock.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("ProjectResources exposes attention without an empty zero block", () => {
  assert.match(resources, /attention: number/)
  assert.match(resources, /onOpenWork: \(\) => void/)
  assert.match(resources, /podAttentionRow\(props.attention\)/)
  assert.match(resources, /Show when=\{attention\(\)\.visible\}/)
  assert.match(resources, /onClick=\{\(\) => props\.onOpenWork\(\)\}/)
})

test("ProjectResources previews at most three recent messages and keeps the inbox route", () => {
  assert.match(resources, /buildRecentMessages\(props\.detail, props\.messages, props\.selfMemberId, Date\.now\(\), 3\)/)
  assert.match(resources, /最近消息/)
  assert.match(resources, /onOpenPanel\("team", "inbox"\)/)
  assert.match(resources, /classList=\{\{ unread: message\.unread \}\}/)
  assert.doesNotMatch(resources, /podRecentMessages/)
  assert.doesNotMatch(resources, /message\.readAt === null/)
})

test("the active-Goal shortcut is retired from the left Pod face", () => {
  assert.doesNotMatch(resources, /mafw-resources-goal/)
  assert.doesNotMatch(resources, /当前目标/)
})

test("the Pod face is not a global tool catalog", () => {
  assert.doesNotMatch(resources, /PAGE_LINKS/)
  assert.doesNotMatch(resources, /onNavigate/)
  assert.doesNotMatch(resources, />工具</)
})

test("MafwShell routes Pod attention into the right work face", () => {
  assert.match(shell, /podAttention=\{podBadgeCount\(\)\}/)
  assert.match(shell, /onPodOpenWork=\{openProjectWork\}/)
  assert.match(leftDock, /attention=\{props\.podAttention \?\? 0\}/)
  assert.match(leftDock, /onOpenWork=\{\(\) => props\.onPodOpenWork\?\.\(\)\}/)
})

test("Pod resources copy points at the right workbench, not the retired workspace", () => {
  assert.match(resources, /团队、邮箱与共享记忆；Goal 工作在右侧工作台「工作」/)
  assert.match(resources, /工作台处理/)
  assert.doesNotMatch(resources, /工作空间/)
  assert.doesNotMatch(resources, /右栏处理/)
})

// 2026-11-04（spec techlead-goal-entry §3.3）：班底焦点行——行 = 目录 + 当前焦点；
// Tech Lead 行走 Goal 入口（requestPodTechLeadOpen），无 live 会话显示待命。
test("roster rows show the current focus and route techlead members through the goal entry", () => {
  assert.match(resources, /memberFocus\(/)
  assert.match(resources, /focus\(\)\.focusText/)
  assert.match(resources, /待命/)
  assert.match(resources, /requestPodTechLeadOpen\(/)
})
