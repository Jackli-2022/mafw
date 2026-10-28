import { expect, test } from "bun:test"
import { shouldRestoreFocus } from "./focus"

test("restores focus only when nothing else claimed it", () => {
  expect(shouldRestoreFocus(null)).toBe(true)
  expect(shouldRestoreFocus({ tagName: "BODY" } as any)).toBe(true)
  expect(shouldRestoreFocus({ tagName: "DIV" } as any)).toBe(false)
})
