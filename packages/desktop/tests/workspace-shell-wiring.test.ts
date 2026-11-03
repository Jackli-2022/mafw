import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

test("the goals destination renders the project workspace, not the legacy Dashboard", () => {
  const shell = read("../src/renderer/mafw/MafwShell.tsx")
  const workspace = read("../src/renderer/mafw/components/WorkspaceHome.tsx")
  assert.match(shell, /import \{ WorkspaceHome \}/)
  assert.match(shell, /activeTab\(\) === "goals"[\s\S]{0,500}<WorkspaceHome/)
  assert.doesNotMatch(shell, /<DashboardPage/)
  assert.match(workspace, /work\.overview\(dir\)/)
  assert.match(workspace, /<WorkOverview/)
  assert.match(workspace, />\s*打开 Lead 对话\s*</)
  assert.match(workspace, />\s*新话题\s*</)
})

test("the work overview is the only list projection and is not truncated", () => {
  const overview = read("../src/renderer/mafw/components/WorkOverview.tsx")
  assert.match(overview, /workspaceSections\(props\.overview \?\? EMPTY\)/)
  assert.match(overview, /section\.count/)
  assert.doesNotMatch(overview, /slice\(0,\s*3\)/)
  assert.match(overview, /全部历史/)
})

test("Welcome no longer maintains the legacy in-memory Goal list", () => {
  const welcome = read("../src/renderer/mafw/components/WelcomeHome.tsx")
  const shell = read("../src/renderer/mafw/MafwShell.tsx")
  assert.doesNotMatch(welcome, /goals\.list\(\)/)
  assert.doesNotMatch(welcome, /activeGoals/)
  assert.doesNotMatch(welcome, /props\.onNavigate\("goals"\)/)
  assert.match(welcome, /onOpenWork: \(\) => void/)
  assert.match(welcome, /props\.onOpenWork\(\)/)
  assert.match(welcome, />项目工作</)
  assert.match(shell, /onOpenWork=\{openProjectWork\}/)
})

test("command palette opens project work in the right workbench", () => {
  const shell = read("../src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /id: "project-work", label: "项目工作"/)
  assert.match(shell, /run: \(\) => openProjectWork\(\)/)
  assert.match(shell, /onOpenGoals=\{openProjectWork\}/)
  assert.doesNotMatch(shell, /nav\("goals", "Goals", "编排总览"\)/)
})

test("free discussions hand off through the Lead without changing the source session", () => {
  const shell = read("../src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /buildLeadHandoff\(\{/)
  assert.match(shell, /window\.api\.mafw\.pod\.handoffGoal\(/)
  assert.match(shell, /sourceRef: handoff\.sourceRef/)
  assert.match(shell, /handoffEligible=\{canHandoffActiveSession\}/)
  assert.doesNotMatch(shell, /handoffActiveSessionToLead[\s\S]{0,1200}sessions\.delete\(/)
  const chat = read("../src/renderer/mafw/components/ChatPane.tsx")
  assert.match(chat, /onHandoffToLead/)
  assert.match(chat, />交给 Lead</)
})

test("workspace navigation labels the compatibility tab as a workspace", () => {
  const nav = read("../src/renderer/mafw/components/nav-tab.ts")
  assert.match(nav, /id: "goals"[^\n]*label: "工作空间"/)
})
