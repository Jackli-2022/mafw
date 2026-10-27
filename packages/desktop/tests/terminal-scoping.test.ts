import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 终端只属工作台视图（2026-10-27 裁决，推翻 10-26「终端跨视图持久」）+ Ctrl+` 快捷键。
test("terminal strip visibility goes through terminalStripVisible", () => {
  const src = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.match(src, /terminalStripVisible\(props\.view, props\.terminalOpen\)/)
  // L1 行尾开关钮只在工作台视图渲染（别的视图不存在终端，不给假开关）
  assert.match(src, /<Show when=\{props\.view === "workbench"\}>[\s\S]*?mafw-rw-terminal-toggle/)
})

test("MafwShell wires Ctrl+` capture-phase hotkey", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /isTerminalToggleKey/)
  assert.match(src, /terminalHotkeyAction/)
  // capture 阶段注册（xterm 聚焦时先生效，防 \x00 落进 PTY）
  assert.match(src, /addEventListener\("keydown", [^,]+, true\)/)
})
