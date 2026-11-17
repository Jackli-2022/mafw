import { describe, expect, test } from "bun:test"
import { pickNavigationWindow } from "./navigation-window-select"

interface FakeWin {
  id: string
  focused: boolean
  aux: boolean
  destroyed?: boolean
}

const select = (windows: FakeWin[], lastFocusedId?: string) =>
  pickNavigationWindow(windows, {
    isFocused: (win) => win.focused,
    isAuxiliary: (win) => win.aux,
    isDestroyed: (win) => !!win.destroyed,
    lastFocused: () => (lastFocusedId ? (windows.find((w) => w.id === lastFocusedId) ?? null) : null),
  })

describe("pickNavigationWindow", () => {
  test("a focused main window wins", () => {
    expect(select([{ id: "main", focused: true, aux: false }])?.id).toBe("main")
  })

  test("a focused auxiliary (floating notification) window is skipped", () => {
    const picked = select([
      { id: "float", focused: true, aux: true },
      { id: "main", focused: false, aux: false },
    ])
    expect(picked?.id).toBe("main")
  })

  test("falls back to lastFocused when the focused one is auxiliary", () => {
    const picked = select(
      [
        { id: "float", focused: true, aux: true },
        { id: "main", focused: false, aux: false },
      ],
      "main",
    )
    expect(picked?.id).toBe("main")
  })

  test("lastFocused auxiliary falls through to any live main window", () => {
    const picked = select(
      [
        { id: "float", focused: false, aux: true },
        { id: "main", focused: false, aux: false },
      ],
      "float",
    )
    expect(picked?.id).toBe("main")
  })

  test("destroyed windows are never picked", () => {
    expect(select([{ id: "dead", focused: true, aux: false, destroyed: true }])).toBeNull()
  })
})
