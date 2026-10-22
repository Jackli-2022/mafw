import { describe, expect, test } from "bun:test"
import { resolveLeftDockWidth, resolveMode, shouldCloseOnSelect, toggleFace } from "./left-dock"

describe("left-dock 状态模型", () => {
  describe("toggleFace（VS Code toggle 语义）", () => {
    test("点已激活的同 face → 收起", () => {
      expect(toggleFace({ face: "sessions", open: true }, "sessions")).toEqual({ face: "sessions", open: false })
    })
    test("不同 face → 保持打开并切换", () => {
      expect(toggleFace({ face: "sessions", open: true }, "search")).toEqual({ face: "search", open: true })
    })
    test("收起态点任一 face → 打开该 face", () => {
      expect(toggleFace({ face: "sessions", open: false }, "search")).toEqual({ face: "search", open: true })
    })
  })

  describe("resolveMode（窗口状态决定；窄断点不再劫持推挤）", () => {
    test("open + 最大化 → push", () => {
      expect(resolveMode(true, true)).toBe("push")
    })
    test("open + 非最大化 → overlay", () => {
      expect(resolveMode(true, false)).toBe("overlay")
    })
    test("closed → closed（无视窗口状态）", () => {
      expect(resolveMode(false, true)).toBe("closed")
    })
  })

  describe("shouldCloseOnSelect（浮层选中即关；推挤保持）", () => {
    test("overlay → true", () => {
      expect(shouldCloseOnSelect("overlay")).toBe(true)
    })
    test("push / closed → false", () => {
      expect(shouldCloseOnSelect("push")).toBe(false)
      expect(shouldCloseOnSelect("closed")).toBe(false)
    })
  })

  describe("resolveLeftDockWidth（新键优先；旧键一次性迁移；加载即 clamp）", () => {
    test("新键有效 → 采用并 clamp 180-400", () => {
      expect(resolveLeftDockWidth("320", null)).toEqual({ width: 320, migrated: false })
      expect(resolveLeftDockWidth("999", null)).toEqual({ width: 400, migrated: false })
      expect(resolveLeftDockWidth("120", null)).toEqual({ width: 180, migrated: false })
    })
    test("新键缺失 → 旧键迁移并 clamp", () => {
      expect(resolveLeftDockWidth(null, "264")).toEqual({ width: 264, migrated: true })
      expect(resolveLeftDockWidth(null, "999")).toEqual({ width: 400, migrated: true })
    })
    test("都缺失/非法 → 默认 264 且不迁移", () => {
      expect(resolveLeftDockWidth(null, null)).toEqual({ width: 264, migrated: false })
      expect(resolveLeftDockWidth("abc", "abc")).toEqual({ width: 264, migrated: false })
    })
  })
})
