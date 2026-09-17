import { describe, expect, test } from "bun:test"
import { trayClickAction, type TrayWindowState } from "./tray-toggle"

const state = (visible: boolean, focused: boolean): TrayWindowState => ({ visible, focused })

describe("trayClickAction", () => {
  test("creates a window when none exists", () => {
    expect(trayClickAction(null)).toBe("create")
  })

  test("shows when the window is hidden", () => {
    expect(trayClickAction(state(false, false))).toBe("show")
  })

  test("shows and focuses when the window is visible but unfocused", () => {
    expect(trayClickAction(state(true, false))).toBe("show")
  })

  test("hides when the window is visible and focused (toggle)", () => {
    expect(trayClickAction(state(true, true))).toBe("hide")
  })
})
