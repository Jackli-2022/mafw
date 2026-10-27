import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { isTerminalToggleKey } from "./terminal-hotkey"

// Ctrl+` / Cmd+` 终端开合（VS Code/Zed 肌肉记忆）。capture 阶段拦截，xterm 聚焦时也要生效。
describe("isTerminalToggleKey", () => {
  const base = { key: "`", code: "Backquote", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }

  test("Ctrl+` 命中", () => {
    assert.equal(isTerminalToggleKey(base), true)
  })
  test("Cmd+`（meta）命中", () => {
    assert.equal(isTerminalToggleKey({ ...base, ctrlKey: false, metaKey: true }), true)
  })
  test("物理键兜底：key 异常但 code=Backquote 仍命中", () => {
    assert.equal(isTerminalToggleKey({ ...base, key: "Unidentified" }), true)
  })
  test("无修饰键 / Shift / Alt 不命中", () => {
    assert.equal(isTerminalToggleKey({ ...base, ctrlKey: false }), false)
    assert.equal(isTerminalToggleKey({ ...base, shiftKey: true }), false)
    assert.equal(isTerminalToggleKey({ ...base, altKey: true }), false)
  })
  test("其他键不命中", () => {
    assert.equal(isTerminalToggleKey({ ...base, key: "b", code: "KeyB" }), false)
  })
})
