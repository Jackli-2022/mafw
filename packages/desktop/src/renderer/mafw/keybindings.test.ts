// C3 自定义快捷键纯模块（W3）：事件→组合键规范化、默认合并、冲突检测、显示格式。
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_KEYBINDINGS, normalizeCombo, matchesCombo, resolveKeybindings,
  findConflicts, formatCombo, isValidCombo,
} from "./keybindings"

const ev = (key: string, mods: Partial<{ctrl: boolean; meta: boolean; alt: boolean; shift: boolean}> = {}) => ({
  key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt, shiftKey: !!mods.shift,
})

describe("normalizeCombo", () => {
  test("Ctrl+` → ctrl+`", () => {
    expect(normalizeCombo(ev("`", { ctrl: true }))).toBe("ctrl+`")
  })
  test("Ctrl+Shift+E → ctrl+shift+e（大小写归一）", () => {
    expect(normalizeCombo(ev("E", { ctrl: true, shift: true }))).toBe("ctrl+shift+e")
  })
  test("Meta 当 ctrl（macOS Cmd）", () => {
    expect(normalizeCombo(ev("p", { meta: true }))).toBe("ctrl+p")
  })
  test("无修饰键 → null（纯打字不拦截）", () => {
    expect(normalizeCombo(ev("b"))).toBeNull()
  })
  test("F 键支持（F1-F12）", () => {
    expect(normalizeCombo(ev("F3", { ctrl: true }))).toBe("ctrl+f3")
  })
  test("Esc/Tab/Enter 等控制键 → null（不能做快捷键）", () => {
    expect(normalizeCombo(ev("Escape", { ctrl: true }))).toBeNull()
    expect(normalizeCombo(ev("Enter", { ctrl: true }))).toBeNull()
    expect(normalizeCombo(ev("Tab", { ctrl: true }))).toBeNull()
  })
})

describe("matchesCombo", () => {
  test("命中与不命中", () => {
    expect(matchesCombo(ev("`", { ctrl: true }), "ctrl+`")).toBe(true)
    expect(matchesCombo(ev("t", { ctrl: true }), "ctrl+`")).toBe(false)
  })
  test("非法/空 combo → false（不炸）", () => {
    expect(matchesCombo(ev("t", { ctrl: true }), "")).toBe(false)
    expect(matchesCombo(ev("t", { ctrl: true }), undefined as any)).toBe(false)
  })
})

describe("resolveKeybindings", () => {
  test("stored 覆盖默认；非法条目丢弃回落默认", () => {
    const resolved = resolveKeybindings({ "toggle-terminal": "ctrl+shift+`", "command-palette": "bogus" } as any)
    expect(resolved["toggle-terminal"]).toBe("ctrl+shift+`")
    expect(resolved["command-palette"]).toBe(DEFAULT_KEYBINDINGS["command-palette"])
  })
  test("空 stored → 全默认", () => {
    expect(resolveKeybindings({})).toEqual(DEFAULT_KEYBINDINGS)
    expect(resolveKeybindings(undefined)).toEqual(DEFAULT_KEYBINDINGS)
  })
})

describe("findConflicts", () => {
  test("两个动作同键 → 报告", () => {
    const c = findConflicts({ ...DEFAULT_KEYBINDINGS, taskbar: "ctrl+p" } as any)
    expect(c).toHaveLength(1)
    expect(c[0].combo).toBe("ctrl+p")
    expect(c[0].actions).toContain("command-palette")
    expect(c[0].actions).toContain("taskbar")
  })
  test("无冲突 → 空", () => {
    expect(findConflicts(DEFAULT_KEYBINDINGS)).toEqual([])
  })
})

describe("formatCombo", () => {
  test("显示格式 Ctrl+Alt+B / Ctrl+Shift+E", () => {
    expect(formatCombo("ctrl+alt+b")).toBe("Ctrl+Alt+B")
    expect(formatCombo("ctrl+shift+e")).toBe("Ctrl+Shift+E")
    expect(formatCombo("ctrl+`")).toBe("Ctrl+`")
  })
})

describe("isValidCombo", () => {
  test("合法/非法", () => {
    expect(isValidCombo("ctrl+p")).toBe(true)
    expect(isValidCombo("ctrl+shift+`")).toBe(true)
    expect(isValidCombo("p")).toBe(false)
    expect(isValidCombo("ctrl+")).toBe(false)
    expect(isValidCombo("")).toBe(false)
  })
})
