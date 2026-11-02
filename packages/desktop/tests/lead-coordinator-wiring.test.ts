// Task 2 review I-1 接线契约：Lead 替换 Manager 后，桌面三处协调会话语义必须一致。
//
// 纯逻辑在 manager-session.ts（有 manager-session.test.ts 行为测试）；这里只锁组件接线：
// 组件是 Solid JSX，渲染代价高，接线层面用源码断言按既有 wiring 测试先例（icon-rail 等）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const workspace = read("../src/renderer/mafw/workspace/session-workspace.ts")
const chatPane = read("../src/renderer/mafw/components/ChatPane.tsx")
const managerCard = read("../src/renderer/mafw/components/ManagerCard.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const welcome = read("../src/renderer/mafw/components/WelcomeHome.tsx")
const agentPicker = read("../src/renderer/mafw/components/pickers/AgentPicker.tsx")
const leftDock = read("../src/renderer/mafw/components/LeftDock.tsx")

test("sessionRole 走 lead 兼容层（lead 与历史 manager 同义）", () => {
  assert.match(workspace, /import \{[^}]*tabSessionRole[^}]*\} from "\.\.\/manager-session"/)
  assert.match(workspace, /return tabSessionRole\(/)
})

test("ChatPane 的协调会话判定接受 lead，并继续锁住 agent 切换", () => {
  assert.match(chatPane, /isLeadSessionRole\(workspace\.sessionRole\(/)
  // 旧判定 `=== "manager"` 会把 Lead 会话当成普通会话（新话题按钮消失、plan/build 锁失效）
  assert.doesNotMatch(chatPane, /workspace\.sessionRole\([^)]*\) === "manager"/)
  assert.match(chatPane, /lockedLead=\{isLead\(\)\}/)
})

test("ManagerCard 打开协调会话时带上 Lead 角色与 Lead 文案", () => {
  assert.match(managerCard, /onSelectSession: \(id: string, title: string, manager: boolean, metadata\?:/)
  assert.match(managerCard, /onSelectSession\(props\.managerSessionId, "Lead", true, \{ mafw: \{ role: "lead" \} \}\)/)
  assert.match(managerCard, />Lead</)
  assert.doesNotMatch(managerCard, />Manager</)
})

test("MafwShell 用 kv 权威 id 兜底解析隐藏的 Lead，并把 metadata 传进 tab", () => {
  assert.match(shell, /import \{[^}]*resolveLeadSession[^}]*\} from "\.\/manager-session"/)
  assert.match(shell, /resolveLeadSession\(\{[\s\S]{0,200}managerSessionId: managerSessionId\(\)/)
  assert.match(shell, /openSessionTab\(manager\.id, manager\.title, manager\.manager, manager\.metadata\)/)
  // 恢复布局时旧 tab 的 manager 角色也要继续被认作协调会话
  assert.match(shell, /isLeadSessionRole\(info\?\.metadata\?\.mafw\?\.role\)/)
})

test("WelcomeHome 用 lead 判定过滤最近会话，错误文案指向 Lead", () => {
  assert.match(welcome, /isLeadSessionRole\(/)
  assert.match(welcome, /未找到 Lead 会话/)
  assert.doesNotMatch(welcome, /未找到 Manager 会话/)
  assert.match(welcome, />Lead 会话</)
})

test("AgentPicker 的锁定过滤同时认 lead 与历史 manager（manager 已被 /api/agents 隐藏）", () => {
  assert.match(agentPicker, /COORDINATOR_AGENT_KEYS/)
  assert.match(agentPicker, /"lead"/)
  assert.match(agentPicker, /"manager"/)
  assert.match(agentPicker, /Lead 会话仅使用 Lead agent/)
})

test("LeftDock 的会话打开回调透传 metadata（ManagerCard → openSessionTab）", () => {
  assert.match(leftDock, /onSelectSession: \(id: string, title\?: string, manager\?: boolean, metadata\?:/)
})
