import { expect, test } from "bun:test"
import { shouldUseNativeMenu, type GuardFacts } from "./guard"

const base: GuardFacts = {
  tagName: "DIV",
  isEditable: false,
  hasSelection: false,
  isMediaOrLink: false,
  forceNative: false,
}

test("only explicit opt-outs suppress the custom menu", () => {
  expect(shouldUseNativeMenu(base)).toBe(false)
  expect(shouldUseNativeMenu({ ...base, isEditable: true })).toBe(false)
  expect(shouldUseNativeMenu({ ...base, hasSelection: true })).toBe(false)
  expect(shouldUseNativeMenu({ ...base, isMediaOrLink: true })).toBe(false)
  expect(shouldUseNativeMenu({ ...base, forceNative: true })).toBe(true)
})
