import { describe, expect, test } from "bun:test"
import { migrateLegacyRail, resolveMode, toggleFace } from "./left-dock"

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

  describe("resolveMode（窗口状态 × 窄断点）", () => {
    test("open + 最大化 + 非窄 → push", () => {
      expect(resolveMode(true, true, false)).toBe("push")
    })
    test("open + 非最大化 → overlay", () => {
      expect(resolveMode(true, false, false)).toBe("overlay")
    })
    test("open + 窄窗口即使最大化 → overlay（窄窗口恒浮层）", () => {
      expect(resolveMode(true, true, true)).toBe("overlay")
    })
    test("closed → closed（无视窗口状态）", () => {
      expect(resolveMode(false, true, false)).toBe("closed")
    })
  })

  describe("migrateLegacyRail（旧键一次性迁移）", () => {
    test("旧 rail 收起过 → 左 dock 尊重收起", () => {
      expect(migrateLegacyRail("1", "264")).toEqual({ open: false, width: 264 })
    })
    test("旧 rail 展开且无宽度 → 展开、宽度沿用 null", () => {
      expect(migrateLegacyRail("0", null)).toEqual({ open: true, width: null })
    })
    test("无旧键 → 不表态（null）", () => {
      expect(migrateLegacyRail(null, null)).toEqual({ open: null, width: null })
    })
  })
})
