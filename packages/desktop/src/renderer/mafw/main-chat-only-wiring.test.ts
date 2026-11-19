import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("main area is chat-only and guards the tab signal", () => {
  const shell = read("MafwShell.tsx")
  assert.doesNotMatch(shell, /showConfig/)
  for (const tab of ["approvals", "triage", "automation", "mcp", "memory"]) {
    assert.doesNotMatch(shell, new RegExp(`activeTab\\(\\) === "${tab}"`))
  }
  assert.match(shell, /if \(activeTab\(\) !== "chat"\) setActiveTab\("chat"\)/)
  assert.match(shell, /const workbenchContent = \(\): WorkbenchContentMode => "project"/)
})

test("navigateWorkbench routes chat, work, memory, config and pages", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /const navigateWorkbench = \(tab: string\) =>/)
  assert.match(shell, /if \(tab === "chat"\) \{ setShowWelcome\(false\); setActiveTab\("chat"\); return \}/)
  assert.match(shell, /if \(tab === "goals" \|\| tab === "workspace"\) \{ openProjectWork\(\); return \}/)
  assert.match(shell, /if \(tab === "memory"\) \{ openMemoryFocus\(\); return \}/)
  assert.match(shell, /if \(tab === "config"\) \{ openConfigPage\(\); return \}/)
  assert.match(shell, /WORKBENCH_PAGE_IDS\.includes\(tab as WorkbenchPageId\)/)
  assert.match(shell, /onNavigateTab=\{\(t\) => navigateWorkbench\(t\)\}/)
  assert.match(shell, /onNavigate=\{\(t\) => \{ navigateWorkbench\(t\); closeLeftDockIfOverlay\(\) \}\}/)
})

test("palette and deep links route through navigateWorkbench", () => {
  const shell = read("MafwShell.tsx")
  const link = read("deep-link.ts")
  assert.match(shell, /run: \(\) => navigateWorkbench\("approvals"\)/)
  assert.match(shell, /run: \(\) => navigateWorkbench\("triage"\)/)
  assert.match(shell, /run: \(\) => navigateWorkbench\("automation"\)/)
  assert.match(shell, /run: \(\) => navigateWorkbench\("mcp"\)/)
  assert.match(shell, /run: \(\) => navigateWorkbench\("memory"\)/)
  assert.match(shell, /navigateWorkbench\(link\.id\)/)
  assert.match(link, /"mcp"/)
  assert.match(link, /"config"/)
})

test("the dock toggle and workbench stay reachable without a config content mode", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /connDown\(\) && !activePageId\(\)/)
  assert.doesNotMatch(shell, /!showConfig\(\)/)
})
