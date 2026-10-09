import { describe, expect, test } from "bun:test"
import { MAIN_WINDOW_MIN_HEIGHT, MAIN_WINDOW_MIN_WIDTH, mainWindowOptions } from "./window-bounds"

describe("main window bounds", () => {
  test("enforces a usable minimum size and passes through position/size", () => {
    const opts = mainWindowOptions({ x: 10, y: 20, width: 1280, height: 800 })
    expect(opts.minWidth).toBe(MAIN_WINDOW_MIN_WIDTH)
    expect(opts.minHeight).toBe(MAIN_WINDOW_MIN_HEIGHT)
    expect(opts.width).toBe(1280)
    expect(opts.height).toBe(800)
    expect(opts.x).toBe(10)
    expect(opts.y).toBe(20)
  })

  test("clamps a restored size below the minimum up to the minimum", () => {
    const opts = mainWindowOptions({ width: 400, height: 300 })
    expect(opts.width).toBe(MAIN_WINDOW_MIN_WIDTH)
    expect(opts.height).toBe(MAIN_WINDOW_MIN_HEIGHT)
  })

  test("omits undefined coordinates instead of writing NaN", () => {
    const opts = mainWindowOptions({ width: 1280, height: 800 })
    expect("x" in opts).toBe(false)
    expect("y" in opts).toBe(false)
  })
})
