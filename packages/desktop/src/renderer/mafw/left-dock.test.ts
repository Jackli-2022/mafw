import { describe, expect, test } from "bun:test"
import { connDotState, effectiveLeftDockWidth, railAriaLabel, resolveLeftDockWidth, resolveMode, restoreLeftDockOpen, shouldAutoRestoreLeftDock, shouldCloseOnSelect, toggleFace } from "./left-dock"

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

  describe("resolveMode（窗口宽度决定；不再看最大化）", () => {
    test("open + 宽度达到 1366 → push", () => {
      expect(resolveMode(true, 1366)).toBe("push")
    })
    test("open + 宽度低于 1366 → overlay", () => {
      expect(resolveMode(true, 1365)).toBe("overlay")
    })
    test("closed → closed（无视宽度）", () => {
      expect(resolveMode(false, 1600)).toBe("closed")
    })
  })

  describe("restoreLeftDockOpen（启动时浮层态不自动展开）", () => {
    test("存储为 open 且宽度不足 → false", () => {
      expect(restoreLeftDockOpen("1", 1088)).toBe(false)
      expect(restoreLeftDockOpen("1", 1365)).toBe(false)
    })
    test("存储为 open 且宽度足够 → true", () => {
      expect(restoreLeftDockOpen("1", 1366)).toBe(true)
    })
    test("关闭/非法存储 → false", () => {
      expect(restoreLeftDockOpen("0", 1600)).toBe(false)
      expect(restoreLeftDockOpen("bogus", 1600)).toBe(false)
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

  describe("宽度预算与拉宽恢复", () => {
    test("1366 推挤时左 dock 夹到 280，保住 Chat ≥520", () => {
      expect(effectiveLeftDockWidth(400, 1366)).toBe(280)
      expect(effectiveLeftDockWidth(264, 1366)).toBe(264)
      expect(effectiveLeftDockWidth(400, 1600)).toBe(400)
    })
    test("启动抑制后拉宽到 1366 恢复存储为 open 的左 dock", () => {
      expect(shouldAutoRestoreLeftDock("1", false, 1366)).toBe(true)
      expect(shouldAutoRestoreLeftDock("1", true, 1600)).toBe(false)
      expect(shouldAutoRestoreLeftDock("0", false, 1600)).toBe(false)
      expect(shouldAutoRestoreLeftDock("1", false, 1365)).toBe(false)
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

  describe("railAriaLabel（徽标进入无障碍名称）", () => {
    test("无徽标 → 原 label", () => {
      expect(railAriaLabel("Dashboard", 0)).toBe("Dashboard")
      expect(railAriaLabel("Dashboard", undefined)).toBe("Dashboard")
    })
    test("有徽标 → 附带待处理数", () => {
      expect(railAriaLabel("Dashboard", 3)).toBe("Dashboard（3 项待处理）")
    })
  })

  describe("connDotState（连接点：stopped 用中性色，不冒充故障）", () => {
    test("常规 phase 映射", () => {
      expect(connDotState("connected", "ready")).toBe("ready")
      expect(connDotState("reconnecting", "ready")).toBe("reconnecting")
      expect(connDotState("down", "failed")).toBe("failed")
      expect(connDotState("initial", "starting")).toBe("starting")
      expect(connDotState("initial", null)).toBe("starting")
    })
    test("gateway 明确 stopped → stopped", () => {
      expect(connDotState("down", "stopped")).toBe("stopped")
    })
  })
})
