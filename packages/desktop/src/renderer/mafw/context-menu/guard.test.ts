import { expect, test } from "bun:test"
import { shouldUseNativeMenu, type GuardFacts } from "./guard"

const base: GuardFacts = {
  tagName: "DIV",
  isEditable: false,
  hasSelection: false,
  isMediaOrLink: false,
  forceNative: false,
}

test("editable, selection, media/link and forced targets use the native menu", () => {
  expect(shouldUseNativeMenu(base)).toBe(false)
  expect(shouldUseNativeMenu({ ...base, isEditable: true })).toBe(true)
  expect(shouldUseNativeMenu({ ...base, hasSelection: true })).toBe(true)
  expect(shouldUseNativeMenu({ ...base, isMediaOrLink: true })).toBe(true)
  expect(shouldUseNativeMenu({ ...base, forceNative: true })).toBe(true)
})
