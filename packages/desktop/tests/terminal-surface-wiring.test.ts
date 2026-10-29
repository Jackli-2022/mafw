import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..", "src", "renderer", "mafw")

test("terminal store restores without connecting and gates local attach", () => {
  const src = readFileSync(join(root, "terminal", "terminal-store.ts"), "utf8")
  assert.match(src, /api\.sessions\.restore/)
  assert.match(src, /setVisible/)
  assert.match(src, /ensureLocal/)
  assert.match(src, /applyTerminalEvent/)
  assert.match(src, /persistedTabs/)
  assert.match(src, /activeId\(\) === local\.id/)
})

test("terminal surface composes all terminal UI pieces", () => {
  const src = readFileSync(join(root, "components", "TerminalSurface.tsx"), "utf8")
  for (const piece of [
    "TerminalView",
    "TerminalHostDrawer",
    "SshHostDialog",
    "HostKeyDialog",
    "TerminalPromptDialog",
    "TerminalStatusBar",
    "DropdownMenu",
  ]) {
    assert.match(src, new RegExp(piece))
  }
  assert.match(src, /setVisible\(props\.active\)/)
  assert.match(src, /ensureLocal\(props\.directory\)/)
  assert.doesNotMatch(src, /from "node:/)
  assert.doesNotMatch(src, /from "ssh2"/)
  assert.doesNotMatch(src, /from "electron"/)
})
