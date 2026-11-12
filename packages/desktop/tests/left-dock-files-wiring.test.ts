import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("files is a left-dock face driven by IconRail, with no inner face switch", () => {
  const rail = read("src/renderer/mafw/components/IconRail.tsx")
  const left = read("src/renderer/mafw/components/LeftDock.tsx")
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const types = read("src/renderer/mafw/left-dock.ts")
  const css = read("src/renderer/mafw/mafw.css")

  assert.match(types, /"files"/)
  assert.match(css, /\.mafw-left-dock-files\s*\{/)
  assert.match(rail, /key:\s*"files"/)
  assert.match(rail, /"folder"/)
  assert.match(left, /FilesDock/)
  assert.match(left, /face === "files"/)
  assert.match(left, /contentRoot=/)
  assert.match(left, /scopeKey=/)
  assert.match(left, /onOpenFile=/)
  assert.doesNotMatch(left, /face-switch|mafw-left-dock-switch/)
})

test("shell passes the active content scope and opens files from the left tree", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const start = shell.indexOf("<LeftDock")
  const block = shell.slice(start, shell.indexOf("/>", start))

  assert.match(block, /contentRoot=\{contentRoot\(\)\}/)
  assert.match(block, /contentScopeKey=\{currentContentScopeKey\(\)\}/)
  assert.match(block, /sessionID=\{currentSessionID\(\)\}/)
  assert.match(block, /onOpenFile=\{/)
  assert.match(block, /openFileInScope\(/)
})
