// Task 19 接线契约：Lead 会话里的 discussing Goal → 打开 Tech Lead 隐藏会话。
//
// 关键不变量：
//   1. 入口卡片在 composer 上方（ChatPane 渲染），由 shell 计算（session 是否 Lead）。
//   2. 打开走 `pod.techLead(podId, goalId)`，标题由 Goal 标题派生——runtime session id
//      只用于 `openSessionTab` 的会话 id，绝不出现在标题/文案里。
//   3. Tech Lead 会话保持隐藏：tab 带 `tech_lead` 角色，不落进会话列表/Lead 语义。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const shell = read("../src/renderer/mafw/MafwShell.tsx")
const chatPane = read("../src/renderer/mafw/components/ChatPane.tsx")
const invite = read("../src/renderer/mafw/components/PodTechLeadInvite.tsx")
const store = read("../src/renderer/mafw/pod-store.ts")

test("pod-store 暴露讨论历史动作（Task 18 SDK 契约）", () => {
  assert.match(store, /techLead\(podID: string, goalID: string/)
  assert.match(store, /pod\.techLead\(podID, goalID/)
  assert.match(store, /async function techLead\(goalID: string\)/)
})

test("MafwShell.openTechLead：Goal 标题派生 tab，隐藏会话 id 不泄漏", () => {
  assert.match(shell, /const openTechLead = async \(goalId: string\)/)
  assert.match(shell, /podStore\.techLead\(goalId\)/)
  assert.match(shell, /const title = techLeadTabTitle\(/)
  assert.match(shell, /openSessionTab\(history\.sessionID, title, false, \{ mafw: \{ role: "tech_lead" \} \}\)/)
  // 标题只由 Goal 派生：不得把 session id 拼进标题
  assert.doesNotMatch(shell, /techLeadTabTitle\([^)]*sessionID/)
})

test("ChatPane 在 composer 上方渲染邀请，点击交给 shell", () => {
  assert.match(chatPane, /import \{ PodTechLeadInvite \} from "\.\/PodTechLeadInvite"/)
  const inviteAt = chatPane.indexOf("<PodTechLeadInvite")
  const composerAt = chatPane.indexOf('class="mafw-composer"')
  assert.ok(inviteAt > 0, "ChatPane 必须渲染 PodTechLeadInvite")
  assert.ok(composerAt > 0, "ChatPane 必须有 composer")
  assert.ok(inviteAt < composerAt, "邀请卡必须在 composer 上方")
  assert.match(chatPane, /techLeadInvite\?\.\(\)/)
  assert.match(chatPane, /onOpenTechLead\?\.\(/)
})

test("邀请卡符合设计契约（Design system 组件，无裸 button/input/title）", () => {
  assert.match(invite, /ButtonV2/)
  assert.doesNotMatch(invite, /<button/)
  assert.doesNotMatch(invite, /<input/)
  assert.doesNotMatch(invite, /\stitle=/)
  assert.match(invite, /onOpen\(props\.goalId\)/)
})

test("shell 只在当前会话是 Lead 时计算邀请", () => {
  assert.match(shell, /activeSessionIsLead/)
  assert.match(shell, /isLeadRole\(tabSessionRole\(/)
  assert.match(shell, /techLeadInvite=\{activeLeadGoalInvite\}/)
  assert.match(shell, /onOpenTechLead=\{\(goalId\) => void openTechLead\(goalId\)\}/)
})

// 2026-11-04（spec techlead-goal-entry §3.1）：邀请条按 Goal 持久化——非终态都在，
// discussing 优先占位；同时携带阶段标签，用户能看出 Goal 现在在哪一步。
test("邀请条随 Goal 持久并携带阶段标签", () => {
  assert.match(shell, /pickTechLeadInviteGoal\(/)
  assert.match(shell, /stageLabel: podStageLabel\(/)
  assert.match(chatPane, /stageLabel=\{invite\(\)\.stageLabel\}/)
  assert.match(invite, /stageLabel/)
})
