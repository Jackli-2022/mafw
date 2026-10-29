import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("Ctrl+` uses surface state, not the retired bottom strip", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /terminalSurfaceHotkeyAction/)
  assert.match(src, /previousSurface/)
  assert.doesNotMatch(src, /mafw-workbench-terminal/)
  assert.doesNotMatch(src, /workbenchTerminalOpen/)
  assert.doesNotMatch(src, /terminalStripVisible/)
  assert.doesNotMatch(src, /terminalHotkeyAction/)
  // capture 阶段注册（xterm 聚焦时先生效，防 \x00 落进 PTY）
  assert.match(src, /addEventListener\("keydown", [^,]+, true\)/)
})

test("terminal surface receives true visibility, not just selection", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  const code = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")
  assert.match(shell, /active=\{props\.open && props\.view === "workbench"\}/)
  assert.match(code, /active=\{props\.active && props\.surface === "terminal"\}/)
})
