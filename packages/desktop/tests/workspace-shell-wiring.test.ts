import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

test("the goals page is retired and legacy routes redirect to right work", () => {
  const shell = read("../src/renderer/mafw/MafwShell.tsx")
  const nav = read("../src/renderer/mafw/components/nav-tab.ts")
  const deepLink = read("../src/renderer/mafw/deep-link.ts")

  assert.doesNotMatch(shell, /import \{ WorkspaceHome \}/)
  assert.doesNotMatch(shell, /<WorkspaceHome/)
  assert.doesNotMatch(shell, /activeTab\(\) === "goals" \? \(/)
  assert.match(shell, /if \(activeTab\(\) === "goals"\) openProjectWork\(\)/)
  assert.match(shell, /function openProjectWork|const openProjectWork/)
  assert.doesNotMatch(nav, /id: "goals"/)
  assert.match(deepLink, /id === "workspace"\) return \{ kind: "tab", id: "goals" \}/)
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
