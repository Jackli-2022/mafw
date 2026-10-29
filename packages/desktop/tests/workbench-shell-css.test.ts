import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("B1 shell owns the right dock and narrow file drawer", () => {
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-rw-shell\s*\{[^}]*container-type:\s*inline-size/)
  assert.match(css, /\.mafw-rw-l1\s*\{[^}]*height:\s*38px/)
  assert.match(css, /\.mafw-rw-l2\s*\{[^}]*height:\s*32px/)
  assert.match(css, /@container \(max-width:\s*599px\)[\s\S]*?mafw-rw-files/)
  assert.match(css, /\.mafw-rw-exec-section\s*\{[^}]*overflow-y:\s*auto/)
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
