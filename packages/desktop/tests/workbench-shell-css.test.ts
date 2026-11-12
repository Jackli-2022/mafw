import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("focus shell keeps the right dock and has no legacy drawer", () => {
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-rw-shell\s*\{[^}]*container-type:\s*inline-size/)
  assert.doesNotMatch(css, /\.mafw-rw-head\s*\{/)
  assert.doesNotMatch(css, /\.mafw-rw-exec-drawer\s*\{/)
  assert.doesNotMatch(css, /\.mafw-rw-l2\s*\{/)
  assert.match(css, /\.mafw-subagent-dock[^{]*\{[^}]*overflow-y:\s*auto/)
  assert.match(css, /\.mafw-bg-dock[^{]*\{[^}]*overflow-y:\s*auto/)
  assert.doesNotMatch(css, /\.mafw-session-rail\s*\{/)
  assert.doesNotMatch(css, /\.mafw-dock-slot\.overlay/)
})

test("bottom strip css is gone; terminal surface css exists", () => {
  const css = read("src/renderer/mafw/mafw.css")
  assert.doesNotMatch(css, /\.mafw-rw-terminal\b/)
  assert.doesNotMatch(css, /\.mafw-rw-terminal-toggle\b/)
  assert.match(css, /\.mafw-terminal-surface\s*\{/)
  assert.match(css, /\.mafw-terminal-tabbar\s*\{/)
  assert.match(css, /\.mafw-host-drawer\s*\{/)
  assert.match(css, /\.mafw-terminal-statusbar\s*\{/)
})
