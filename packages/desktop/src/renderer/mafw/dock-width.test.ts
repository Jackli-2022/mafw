import { describe, expect, test } from "bun:test"
import { clampDockWidth, dockMaxWidth, suggestDockWidth } from "./dock-width"

describe("dock-width（按 tab 的宽度策略，纯函数）", () => {
  test("普通 tab 上限 480；工作台 tab（files/editor）上限 = 窗口 50%（不低于 min）", () => {
    expect(dockMaxWidth("tasks", 1600)).toBe(480)
    expect(dockMaxWidth("editor", 1600)).toBe(800)
    expect(dockMaxWidth("files", 1600)).toBe(800)
    expect(dockMaxWidth("terminal", 1600)).toBe(800)
    expect(dockMaxWidth("editor", 720)).toBe(360) // 50% 而非 Math.max(480)
  })
  test("clamp：min 240、上限按 tab", () => {
    expect(clampDockWidth("tasks", 100, 1600)).toBe(240)
    expect(clampDockWidth("tasks", 999, 1600)).toBe(480)
    expect(clampDockWidth("editor", 999, 1600)).toBe(800)
    expect(clampDockWidth("editor", 400, 720)).toBe(360)
  })
  test("suggest：工作台 tab 只增不减（窄窗口不再压缩用户宽度）", () => {
    expect(suggestDockWidth("editor", 320, 1600)).toBe(560)
    expect(suggestDockWidth("editor", 470, 720)).toBe(470) // 目标 360 < 470 → 不缩
    expect(suggestDockWidth("files", 700, 1600)).toBe(700)
    expect(suggestDockWidth("tasks", 320, 1600)).toBe(320)
  })
})
