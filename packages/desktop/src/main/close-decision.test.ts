import { describe, expect, test } from "bun:test"
import { windowCloseAction } from "./close-decision"

describe("window close action", () => {
  test("always close while the app is quitting", () => {
    expect(windowCloseAction({ isQuitting: true, closeToTray: true })).toBe("close")
  })

  test("hides to tray when enabled and not quitting", () => {
    expect(windowCloseAction({ isQuitting: false, closeToTray: true })).toBe("hide-to-tray")
  })

  test("closes when the preference is off", () => {
    expect(windowCloseAction({ isQuitting: false, closeToTray: false })).toBe("close")
  })
})
