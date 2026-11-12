import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("Ctrl+` toggles a terminal focus subject", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /openTerminalFocus/)
  assert.match(src, /activeFocus\(\)\?\.subject\.kind === "terminal"/)
  assert.doesNotMatch(src, /mafw-workbench-terminal/)
  assert.doesNotMatch(src, /workbenchTerminalOpen/)
  assert.doesNotMatch(src, /terminalStripVisible/)
  assert.doesNotMatch(src, /terminalSurfaceHotkeyAction/)
  // capture 阶段注册（xterm 聚焦时先生效，防 \x00 落进 PTY）
  assert.match(src, /addEventListener\("keydown", [^,]+, true\)/)
})

test("terminal surface receives true visibility, not just selection", () => {
  const stage = read("src/renderer/mafw/components/FocusStage.tsx")
  assert.match(stage, /kind\(\) === "terminal"/)
  assert.match(stage, /active=\{props\.active\}/)
})
