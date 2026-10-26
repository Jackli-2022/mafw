import { describe, expect, test } from "bun:test"
import {
  fitDefaultWindowSize,
  MAIN_WINDOW_MIN_HEIGHT,
  MAIN_WINDOW_MIN_WIDTH,
  mainWindowOptions,
} from "./window-bounds"

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

  test("minimum window guarantees 46 + 520 + 520", () => {
    expect(MAIN_WINDOW_MIN_WIDTH).toBe(1088)
    expect(MAIN_WINDOW_MIN_HEIGHT).toBe(720)
    const opts = mainWindowOptions({ width: 400, height: 300 })
    expect(opts.minWidth).toBe(1088)
    expect(opts.minHeight).toBe(720)
    expect(opts.width).toBe(1088)
    expect(opts.height).toBe(720)
  })

  test("default window targets 1600x1000 but respects work area", () => {
    expect(fitDefaultWindowSize({ width: 3000, height: 2000 })).toEqual({ width: 1600, height: 1000 })
    expect(fitDefaultWindowSize({ width: 1920, height: 1040 })).toEqual({ width: 1600, height: 960 })
    expect(fitDefaultWindowSize({ width: 1366, height: 728 })).toEqual({ width: 1286, height: 720 })
    expect(fitDefaultWindowSize({ width: 1024, height: 600 })).toEqual({ width: 1088, height: 720 })
  })
})
