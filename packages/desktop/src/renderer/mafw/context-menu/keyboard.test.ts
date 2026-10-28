import { expect, test } from "bun:test"
import { isMenuKey } from "./keyboard"

test("menu key is Shift+F10 or the ContextMenu key", () => {
  expect(isMenuKey({ key: "F10", shiftKey: true })).toBe(true)
  expect(isMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true)
  expect(isMenuKey({ key: "F10", shiftKey: false })).toBe(false)
  expect(isMenuKey({ key: "F9", shiftKey: true })).toBe(false)
})
