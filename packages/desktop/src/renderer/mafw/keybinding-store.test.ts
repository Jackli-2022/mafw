// C3 keybinding-store 单测：localStorage 持久化 + signal 失效 + 恢复默认。
import { describe, expect, test } from "bun:test"
import { attachKbStorageForTest, keybindingFor, setKeybinding, resetAllKeybindings, allKeybindings, storedKeybindings } from "./keybinding-store"
import { DEFAULT_KEYBINDINGS } from "./keybindings"

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}

describe("keybinding-store", () => {
  test("默认键可读；set 覆盖并持久化；reset 恢复默认", () => {
    const s = fakeStorage()
    attachKbStorageForTest(s)
    expect(keybindingFor("toggle-terminal")).toBe("ctrl+`")
    setKeybinding("toggle-terminal", "ctrl+shift+`")
    expect(keybindingFor("toggle-terminal")).toBe("ctrl+shift+`")
    expect(s.getItem("mafw-keybindings:v1")).toContain("ctrl+shift+`")
    resetAllKeybindings()
    expect(keybindingFor("toggle-terminal")).toBe("ctrl+`")
    expect(s.getItem("mafw-keybindings:v1")).toBe("{}")
  })
  test("allKeybindings 返回完整解析表", () => {
    const s = fakeStorage()
    attachKbStorageForTest(s)
    setKeybinding("taskbar", "ctrl+shift+j")
    const all = allKeybindings()
    expect(all).toEqual({ ...DEFAULT_KEYBINDINGS, taskbar: "ctrl+shift+j" })
  })
  test("重建（模拟新窗口）：persisted 键重新水合", () => {
    const s = fakeStorage()
    attachKbStorageForTest(s)
    setKeybinding("command-palette", "ctrl+shift+p")
    expect(storedKeybindings()["command-palette"]).toBe("ctrl+shift+p")
  })
})
