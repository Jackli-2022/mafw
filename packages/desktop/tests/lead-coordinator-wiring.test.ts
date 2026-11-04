// Task 2 review I-1 接线契约：Lead 替换 Manager 后，桌面三处协调会话语义必须一致。
//
// 纯逻辑在 lead-session.ts（有 lead-session.test.ts 行为测试）；这里只锁组件接线：
// 组件是 Solid JSX，渲染代价高，接线层面用源码断言按既有 wiring 测试先例（icon-rail 等）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

const workspace = read("../src/renderer/mafw/workspace/session-workspace.ts")
const chatPane = read("../src/renderer/mafw/components/ChatPane.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const welcome = read("../src/renderer/mafw/components/WelcomeHome.tsx")
const agentPicker = read("../src/renderer/mafw/components/pickers/AgentPicker.tsx")
const leftDock = read("../src/renderer/mafw/components/LeftDock.tsx")

test("sessionRole 只从 lead-session 解析，manager 是普通历史", () => {
  assert.match(workspace, /import \{[^}]*tabSessionRole[^}]*\} from "\.\.\/lead-session"/)
  assert.match(workspace, /return tabSessionRole\(/)
  assert.doesNotMatch(workspace, /manager-session/)
})

test("ChatPane 的协调会话判定只接受 lead，并继续锁住 agent 切换", () => {
  assert.match(chatPane, /isLeadRole\(workspace\.sessionRole\(/)
  assert.doesNotMatch(chatPane, /workspace\.sessionRole\([^)]*\) === "manager"/)
  // 锁定迁移到会话配置菜单的 Agent 行（agent pill 已收敛进菜单）；creator 会话同样锁定。
  assert.match(chatPane, /agentLocked=\{isLead\(\) \|\| creatorLocked\(\)\}/)
  // creator 锁定同时认本地 picks 与会话持久化的 agent（session.agent 是展示真值）。
  assert.match(chatPane, /isAgentKey\(props\.agentSel\(\), "mafw-create"\)/)
  assert.match(chatPane, /=== "mafw-create"/)
})

test("MafwShell 从显式 Lead id 解析隐藏会话，并把 metadata 传进 tab", () => {
  assert.match(shell, /import \{[^}]*resolveLeadSession[^}]*\} from "\.\/lead-session"/)
  assert.match(shell, /resolveLeadSession\(\{ leadSessionId: ensured\.sessionId \}\)/)
  assert.match(shell, /openSessionTab\(lead\.id, lead\.title, lead\.lead, lead\.metadata\)/)
  assert.match(shell, /isLeadRole\(info\?\.metadata\?\.mafw\?\.role\)/)
})

test("恢复布局不把隐藏的 Lead 当成已删除会话（prune 前带上 Pod coordination id）", () => {
  // Lead 不在 /api/sessions 里：只按 history 建 keep 集合会在重载/切项目时丢掉 Lead tab。
  assert.match(shell, /pruneMissing\(snap, existing, [^)]*leadId/)
  assert.match(shell, /const leadId = currentLeadId\(project\)/)
  // Pod lookup 未定论前不恢复布局（否则先 prune 后 id 才到，仍会丢 tab）。
  assert.match(shell, /leadResolvedFor\(pd\)/)
  assert.doesNotMatch(shell, /fetchManagerSession/)
})

test("WelcomeHome 只用 lead 判定过滤最近会话，不保留 manager fallback", () => {
  assert.match(welcome, /isLeadRole\(/)
  assert.doesNotMatch(welcome, /isLeadSessionRole\(/)
  assert.match(welcome, />Lead 会话</)
})

test("AgentPicker 的锁定过滤同时认 lead 与历史 manager（manager 已被 /api/agents 隐藏）", () => {
  assert.match(agentPicker, /COORDINATOR_AGENT_KEYS/)
  assert.match(agentPicker, /"lead"/)
  assert.match(agentPicker, /"manager"/)
  assert.match(agentPicker, /Lead 会话仅使用 Lead agent/)
})

test("LeftDock 的会话打开回调透传 metadata（Pod/tab restore → openSessionTab）", () => {
  assert.match(leftDock, /onSelectSession: \(id: string, title\?: string, lead\?: boolean, metadata\?:/)
})
