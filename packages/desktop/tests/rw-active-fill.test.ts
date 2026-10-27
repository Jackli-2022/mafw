import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 右 dock 选中态与左 rail 统一：幽灵底 + accent 12% 填充 + accent 前景。
// 用语义属性选择器（aria-selected / aria-pressed）——ButtonV2 的 classList 对多 token class 不可靠。
test("workbench tabs use fill-block active (no contrast variant)", () => {
  const src = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(src, /variant=\{props\.(view|surface|terminalOpen)[^}]*"contrast"/)
  assert.match(src, /aria-selected=\{props\.view === item\.id\}/)
  assert.match(src, /aria-selected=\{props\.surface === surface\.id\}/)
  assert.match(src, /aria-pressed=\{props\.terminalOpen\}/)
})

test("right dock active CSS mirrors the rail fill (attribute selectors)", () => {
  const css = read("src/renderer/mafw/mafw.css")
  const rule = css.match(/\.mafw-rw-tab\[aria-selected="true"\],[\s\S]*?\{([^}]*)\}/)?.[1] ?? ""
  assert.match(rule, /color-mix\(in srgb, var\(--accent\) 12%, transparent\)/)
  assert.match(rule, /color: var\(--accent\)/)
  assert.match(css, /\.mafw-rw-l2-tab\[aria-selected="true"\]/)
  assert.match(css, /\.mafw-rw-terminal-toggle\[aria-pressed="true"\]/)
})
