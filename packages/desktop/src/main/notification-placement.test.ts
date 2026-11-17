import { describe, expect, test } from "bun:test"
import { notificationWindowBounds } from "./notification-placement"

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }

describe("notificationWindowBounds", () => {
  test("one card sits bottom-right with the default margin", () => {
    expect(notificationWindowBounds({ workArea, count: 1 })).toEqual({
      x: 1920 - 16 - 360,
      y: 1080 - 16 - 92,
      width: 360,
      height: 92,
    })
  })

  test("three cards stack upward", () => {
    const bounds = notificationWindowBounds({ workArea, count: 3 })
    expect(bounds.height).toBe(3 * 92 + 2 * 10)
    expect(bounds.y).toBe(1080 - 16 - bounds.height)
  })

  test("more than maxVisible clamps to three", () => {
    expect(notificationWindowBounds({ workArea, count: 5 }).height).toBe(3 * 92 + 2 * 10)
  })

  test("zero cards has zero height and stays bottom-right", () => {
    const bounds = notificationWindowBounds({ workArea, count: 0 })
    expect(bounds.height).toBe(0)
    expect(bounds.x).toBe(1920 - 16 - 360)
    expect(bounds.y).toBe(1080 - 16)
  })

  test("small work areas clamp width and height inside the margin", () => {
    const small = { x: 200, y: 100, width: 300, height: 200 }
    const bounds = notificationWindowBounds({ workArea: small, count: 3 })
    expect(bounds.width).toBe(300 - 32)
    expect(bounds.height).toBe(200 - 32)
    expect(bounds.x).toBe(200 + 16)
    expect(bounds.y).toBe(100 + 16)
  })

  test("negative count is treated as zero", () => {
    expect(notificationWindowBounds({ workArea, count: -2 }).height).toBe(0)
  })
})
