import { describe, expect, test } from "bun:test"
import { CHAT_WIDTH, clampChatWidth, defaultChatWidth, defaultDockOpen, defaultDockTab } from "./workbench-defaults"

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
  test("chat 宽度 clamp 320-560", () => {
    expect(CHAT_WIDTH.min).toBe(320)
    expect(CHAT_WIDTH.max).toBe(560)
    expect(clampChatWidth(200)).toBe(320)
    expect(clampChatWidth(420)).toBe(420)
    expect(clampChatWidth(999)).toBe(560)
  })
  test("chat 默认宽度 = 38.2% 可用宽，clamp 360-520（黄金分割）", () => {
    expect(defaultChatWidth(1092)).toBe(417)
    expect(defaultChatWidth(1234)).toBe(471)
    expect(defaultChatWidth(700)).toBe(360)
    expect(defaultChatWidth(2000)).toBe(520)
  })
})
