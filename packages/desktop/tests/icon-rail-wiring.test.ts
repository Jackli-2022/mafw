import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("IconRail: six buttons, one family, approved order", () => {
  const src = read("src/renderer/mafw/components/IconRail.tsx")
  assert.match(src, /onNewSession/)
  assert.doesNotMatch(src, /<svg/) // 内联 SVG 全退役（图标只走 icon 表）
  const at = (s: string) => src.indexOf(s)
  assert.ok(at('"bubble-5"') > 0, "sessions icon")
  assert.ok(at('"magnifying-glass"') > at('"bubble-5"'), "search after sessions")
  assert.ok(at('"sticky-note"') > at('"magnifying-glass"'), "notes in destination group")
  assert.ok(at('"layout-grid"') > at('"sticky-note"'), "dashboard after destination spacer")
  assert.ok(at('"settings-gear"') > at('"layout-grid"'), "config last")
  // 单 spacer：目的地组连排，便签在 spacer 之前
  const spacer = src.indexOf("mafw-icon-rail-spacer")
  assert.ok(at('"sticky-note"') < spacer, "notes before spacer")
  assert.equal(src.split("mafw-icon-rail-spacer").length - 1, 1, "exactly one spacer")
})

test("IconRail: new-session action opens the builder-driven context menu", () => {
  const src = read("src/renderer/mafw/components/IconRail.tsx")
  assert.match(src, /buildRailNewMenu/)
  assert.match(src, /menuController\.request/)
  assert.match(src, /onNewWorktreeSession/)
  assert.match(src, /worktreeEnabled/)
  assert.doesNotMatch(src, /<ContextMenu/)
})

test("IconRail: theme button retired (no emoji, no toggle)", () => {
  const src = read("src/renderer/mafw/components/IconRail.tsx")
  assert.doesNotMatch(src, /onToggleTheme|切换主题|☀/)
})

test("MafwShell wires rail actions, drops theme prop", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const start = shell.indexOf("<IconRail")
  const block = shell.slice(start, shell.indexOf("/>", start))
  assert.match(block, /onNewSession=/)
  assert.match(block, /onNewWorktreeSession=/)
  assert.match(block, /worktreeEnabled=/)
  assert.doesNotMatch(block, /onToggleTheme|theme=\{theme\(\)\}/)
})

test("rail visual CSS: fill-block active, dashed action, quiet conn dot", () => {
  const css = read("src/renderer/mafw/mafw.css")
  const active = css.match(/\.mafw-icon-rail-icon\.active\s*\{([^}]*)\}/)?.[1] ?? ""
  assert.match(active, /color-mix\(in srgb, var\(--accent\) 12%, transparent\)/)
  assert.match(active, /color: var\(--accent\)/)
  assert.doesNotMatch(active, /inset 2px/)
  assert.match(css, /\.mafw-icon-rail-icon\.new-action/)
  const ready = css.match(/\.mafw-icon-rail-conn-dot\.ready\s*\{([^}]*)\}/)?.[1] ?? ""
  assert.doesNotMatch(ready, /mafw-breathe|box-shadow/)
  assert.match(css, /@keyframes mafw-breathe/) // 其他消费者仍需要 keyframes
  assert.match(css, /\.mafw-icon-rail-icon\[data-component="button-v2"\][^{]*\{[^}]*min-height:\s*34px/)
})
