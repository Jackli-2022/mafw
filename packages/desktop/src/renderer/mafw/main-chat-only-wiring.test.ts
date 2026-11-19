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
  assert.doesNotMatch(shell, /workbenchContent/)
})

test("navigateWorkbench routes chat, work, memory, config and pages", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /const navigateWorkbench = \(tab: string\) =>/)
  assert.match(shell, /if \(tab === "chat"\) \{ setShowWelcome\(false\); setActiveTab\("chat"\); return \}/)
  assert.match(shell, /if \(tab === "goals" \|\| tab === "workspace"\) \{ openProjectWork\(\); return \}/)
  assert.match(shell, /if \(tab === "memory"\) \{ openMemoryFocus\(\); return \}/)
  assert.match(shell, /if \(tab === "config"\) \{ openConfigPage\(\); return \}/)
  assert.match(shell, /WORKBENCH_PAGE_IDS\.includes\(tab as WorkbenchPageId\)/)
  // Unknown tabs fall through to chat instead of blanking the main area.
  assert.match(shell, /setActiveTab\("chat"\)\s*\n\s*\}/)
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
  assert.doesNotMatch(shell, /workbenchContent|WorkbenchContentMode/)
  assert.doesNotMatch(shell, /connDown\(\) && activeTab\(\) !== "chat"/)
})

test("closing tabs prunes their focus so back cannot resurrect a closed page", () => {
  const shell = read("MafwShell.tsx")
  assert.match(shell, /const pruneClosedTabsFromFocus = \(closedIds: readonly string\[\]\) =>/)
  assert.match(shell, /pruneClosedTabsFromFocus\(\[id\]\)/)
  assert.match(shell, /pruneClosedTabsFromFocus\(\[\.\.\.closing\]\)/)
  // A scene subject only maps to a tab that actually exists; the fallback
  // ensureSceneTabFor must be reachable for restored/trimmed tabs.
  assert.match(shell, /return documentTabs\(\)\.some\(\(entry\) => entry\.id === id\) \? id : null/)
  // document store activeId can land after focus restore: the stale guard must be reactive.
  assert.match(shell, /createEffect\(\(\) => \{\s*if \(isStalePageActiveTab\(activeDocumentTabId\(\), focusState\(\)\.stack\.map/)
})
