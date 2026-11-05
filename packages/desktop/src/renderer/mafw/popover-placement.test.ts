import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { computePopoverPlacement } from "./popover-placement"

const trigger = (top: number, height = 40) => ({
  top,
  bottom: top + height,
  left: 100,
  right: 300,
  width: 200,
})
const viewport = (width = 1200, height = 800) => ({ width, height })

describe("popover placement", () => {
  test("opens above the trigger when there is room", () => {
    const p = computePopoverPlacement({
      trigger: trigger(680),
      viewport: viewport(),
      anchor: "tr",
      width: 260,
      height: 150,
    })
    expect(p.top).toBe(680 - 8 - 150)
    expect(p.left).toBe(300 - 260)
    expect(p.width).toBe(260)
  })

  test("content growth keeps the popover above (the Thinking submenu must not grow off-screen)", () => {
    const before = computePopoverPlacement({
      trigger: trigger(680), viewport: viewport(), anchor: "tr", width: 260, height: 150,
    })
    const after = computePopoverPlacement({
      trigger: trigger(680), viewport: viewport(), anchor: "tr", width: 260, height: 480,
    })
    expect(after.top).toBe(680 - 8 - 480)
    expect(after.top).toBeLessThan(before.top)
    expect(after.top + 480).toBeLessThanOrEqual(800 - 8)
  })

  test("flips below when above is too tight and below fits", () => {
    const p = computePopoverPlacement({
      trigger: trigger(120),
      viewport: viewport(),
      anchor: "tr",
      width: 260,
      height: 300,
    })
    expect(p.top).toBe(120 + 40 + 8)
  })

  test("clamps to the larger side when neither side fully fits", () => {
    const p = computePopoverPlacement({
      trigger: trigger(380),
      viewport: viewport(1200, 800),
      anchor: "tr",
      width: 260,
      height: 700,
    })
    expect(p.top).toBe(8)
    expect(p.top + 700).toBeLessThanOrEqual(800 - 8)
  })

  test("width/left clamp and bl alignment", () => {
    const p = computePopoverPlacement({
      trigger: { top: 400, bottom: 440, left: 10, right: 60, width: 50 },
      viewport: viewport(280, 800),
      anchor: "bl",
      width: 400,
      height: 200,
    })
    expect(p.width).toBe(280 - 16)
    expect(p.left).toBe(8)
  })

  test("below-center centers and flips above", () => {
    const centered = computePopoverPlacement({
      trigger: { top: 120, bottom: 160, left: 500, right: 700, width: 200 },
      viewport: viewport(1200, 800),
      anchor: "below-center",
      width: 300,
      height: 200,
    })
    expect(centered.top).toBe(162)
    expect(centered.left).toBe(450)

    const flipped = computePopoverPlacement({
      trigger: { top: 600, bottom: 640, left: 500, right: 700, width: 200 },
      viewport: viewport(1200, 800),
      anchor: "below-center",
      width: 300,
      height: 300,
    })
    expect(flipped.top).toBe(600 - 8 - 300)
  })

  test("PopoverShell re-anchors when content height changes", () => {
    const src = readFileSync(
      new URL("./components/pickers/PopoverShell.tsx", import.meta.url),
      "utf8",
    )
    expect(src).toContain("computePopoverPlacement(")
    expect(src).toContain("new ResizeObserver")
    expect(src).toContain("offsetHeight")
  })
})
