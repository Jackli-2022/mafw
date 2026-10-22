import { describe, expect, test } from "bun:test"
import { CHAT_WIDTH, clampChatWidth, defaultDockOpen, defaultDockTab } from "./workbench-defaults"

// spec 2026-10-22-workbench-layout：工作台默认打开（尊重显式关闭）、默认文件 tab、chat 定宽。
describe("workbench 默认值", () => {
  test("工作台默认打开；显式关闭过则尊重", () => {
    expect(defaultDockOpen(null)).toBe(true)
    expect(defaultDockOpen("1")).toBe(true)
    expect(defaultDockOpen("0")).toBe(false)
  })
  test("默认 tab = files；已存 tab 透传", () => {
    expect(defaultDockTab(null)).toBe("files")
    expect(defaultDockTab("usage")).toBe("usage")
  })
  test("chat 宽度 clamp 280-480，默认 340", () => {
    expect(CHAT_WIDTH.default).toBe(340)
    expect(clampChatWidth(200)).toBe(280)
    expect(clampChatWidth(340)).toBe(340)
    expect(clampChatWidth(999)).toBe(480)
  })
})
