import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const nav = read("src/renderer/mafw/components/nav-tab.ts")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const rail = read("src/renderer/mafw/components/IconRail.tsx")
const page = read("src/renderer/mafw/pages/McpPage.tsx")
const chat = read("src/renderer/mafw/components/ChatPane.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("MCP is a first-class nav destination", () => {
  assert.match(nav, /"mcp"/)
  assert.match(shell, /<McpPage compact \/>/)
  assert.match(shell, /onMcp=/)
  assert.match(shell, /navigateWorkbench\("mcp"\)/)
  assert.match(rail, /icon: "mcp"/)
  assert.match(chat, /trigger: "\/mcp"/)
})

test("MCP page shows connection status and actions", () => {
  assert.match(page, /window\.api\.mafw\.mcp\.servers\(\)/)
  assert.match(page, /mcpStatusLabel/)
  assert.match(page, /mcp\.connect/)
  assert.match(page, /mcp\.disconnect/)
  assert.match(page, /PageHeader/)
  assert.match(page, /ButtonV2/)
  assert.doesNotMatch(page, /<button/)
})

test("MCP page uses token-based status styles", () => {
  assert.match(css, /\.mafw-mcp-summary/)
  assert.match(css, /\.mafw-mcp-status--ok/)
  assert.match(css, /var\(--success\)/)
})
