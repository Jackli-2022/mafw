import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("McpPage has a compact dock mode with its own action row", () => {
  const page = read("McpPage.tsx")
  assert.match(page, /compact\?: boolean/)
  assert.match(page, /classList=\{\{ "is-compact": !!props\.compact \}\}/)
  assert.match(page, /class="mafw-mcp-compact-actions"/)
  assert.match(page, /when=\{!props\.compact\}/)
  assert.match(page, /刷新/)
  assert.match(page, /添加服务器/)
})

test("mcp opens in the right workbench from the rail and renderPage", () => {
  const shell = read("../MafwShell.tsx")
  assert.match(shell, /onMcp=\{\(\) => openPageFocus\("mcp"\)\}/)
  assert.match(shell, /case "mcp":\s*\n\s*return <McpPage compact \/>/)
})
