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

  test("minimum window keeps the hard fallback at 900x600", () => {
    expect(MAIN_WINDOW_MIN_WIDTH).toBe(900)
    expect(MAIN_WINDOW_MIN_HEIGHT).toBe(600)
    const opts = mainWindowOptions({ width: 400, height: 300 })
    expect(opts.minWidth).toBe(900)
    expect(opts.minHeight).toBe(600)
    expect(opts.width).toBe(900)
    expect(opts.height).toBe(600)
  })

  test("default window targets 1720x1000 but respects work area", () => {
    expect(fitDefaultWindowSize({ width: 3000, height: 2000 })).toEqual({ width: 1720, height: 1000 })
    expect(fitDefaultWindowSize({ width: 1920, height: 1080 })).toEqual({ width: 1720, height: 1000 })
    expect(fitDefaultWindowSize({ width: 1920, height: 1040 })).toEqual({ width: 1720, height: 960 })
    expect(fitDefaultWindowSize({ width: 1366, height: 768 })).toEqual({ width: 1286, height: 688 })
    expect(fitDefaultWindowSize({ width: 1024, height: 768 })).toEqual({ width: 944, height: 688 })
    expect(fitDefaultWindowSize({ width: 800, height: 500 })).toEqual({ width: 900, height: 600 })
  })
})
