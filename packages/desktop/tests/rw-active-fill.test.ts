import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 右 dock 选中态与左 rail 统一：幽灵底 + accent 12% 填充 + accent 前景。
// 用语义属性选择器（aria-selected / aria-pressed）——ButtonV2 的 classList 对多 token class 不可靠。
test("terminal tabs keep the fill-block active state", () => {
  const surface = read("src/renderer/mafw/components/TerminalSurface.tsx")
  assert.match(surface, /aria-selected=\{store\.activeId\(\) === session\.id\}/)
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-terminal-tab\[aria-selected="true"\]/)
})
