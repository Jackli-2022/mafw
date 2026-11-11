import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const dock = readFileSync(join(import.meta.dirname, "components/FilesDock.tsx"), "utf8")
const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

test("FilesDock restores and persists tree state per content scope", () => {
  assert.match(dock, /scopeKey/)
  assert.match(dock, /contentScopeStateFor\(/)
  assert.match(dock, /saveContentScopeState\(/)
  assert.match(dock, /treeExpanded/)
  assert.match(dock, /treeSelected/)
  assert.match(dock, /aria-current=/)
  assert.match(dock, /is-selected/)
  assert.match(dock, /loadToken/)
  assert.match(dock, /root !== props\.contentRoot/)
})

test("selected file rows use theme tokens", () => {
  assert.match(css, /\.mafw-file-tree-row\.is-selected\s*\{[^}]*var\(--/)
})
