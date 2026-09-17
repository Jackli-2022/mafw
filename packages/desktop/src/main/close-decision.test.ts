import { describe, expect, test } from "bun:test"
import { windowCloseAction } from "./close-decision"

describe("window close action", () => {
  test("always close while the app is quitting", () => {
    expect(windowCloseAction({ isQuitting: true, closeToTray: true, trayAvailable: true })).toBe("close")
  })

  test("hides to tray when enabled, not quitting, and a tray icon exists", () => {
    expect(windowCloseAction({ isQuitting: false, closeToTray: true, trayAvailable: true })).toBe("hide-to-tray")
  })

  test("closes when close-to-tray is on but no tray icon exists", () => {
    // Hiding the only window with no tray icon would leave the app unreachable.
    expect(windowCloseAction({ isQuitting: false, closeToTray: true, trayAvailable: false })).toBe("close")
  })

  test("closes when the preference is off", () => {
    expect(windowCloseAction({ isQuitting: false, closeToTray: false, trayAvailable: true })).toBe("close")
  })
})
