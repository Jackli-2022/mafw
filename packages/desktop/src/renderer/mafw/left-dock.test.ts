import { describe, expect, test } from "bun:test"
import { migrateLegacyRailWidth, resolveMode, toggleFace } from "./left-dock"

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

  describe("migrateLegacyRailWidth（旧宽度键一次性迁移）", () => {
    test("旧宽度存在 → 采用", () => {
      expect(migrateLegacyRailWidth("264")).toBe(264)
    })
    test("旧宽度缺失 → null（由新键默认值决定）", () => {
      expect(migrateLegacyRailWidth(null)).toBeNull()
    })
    test("旧宽度非法 → null", () => {
      expect(migrateLegacyRailWidth("abc")).toBeNull()
    })
  })
})
