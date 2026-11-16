import { describe, expect, test } from "bun:test"
import { placeSelectionToolbar } from "./annotation-selection"

const toolbar = { w: 150, h: 30 }
const container = { w: 600, h: 400 }

describe("placeSelectionToolbar", () => {
  test("优先放在选区上方并水平居中", () => {
    const p = placeSelectionToolbar(
      { left: 100, top: 100, width: 50, height: 18 },
      toolbar,
      container,
    )
    expect(p).toEqual({ left: 50, top: 64 })
  })

  test("上方空间不足时放到选区下方", () => {
    const p = placeSelectionToolbar(
      { left: 100, top: 10, width: 50, height: 18 },
      toolbar,
      container,
    )
    expect(p.top).toBe(34)
  })

  test("靠近右边缘时 clamp 到容器内", () => {
    const p = placeSelectionToolbar(
      { left: 570, top: 100, width: 20, height: 18 },
      toolbar,
      container,
    )
    expect(p.left).toBe(442)
  })

  test("上下都放不下时仍 clamp 在容器内", () => {
    const p = placeSelectionToolbar(
      { left: 10, top: 190, width: 40, height: 200 },
      toolbar,
      { w: 200, h: 220 },
    )
    expect(p.left).toBe(8)
    expect(p.top).toBeGreaterThanOrEqual(8)
    expect(p.top).toBeLessThanOrEqual(220 - toolbar.h - 8)
  })
})
