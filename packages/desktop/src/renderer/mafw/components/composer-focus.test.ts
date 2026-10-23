import { expect, test } from "bun:test"
import { shouldFocusComposerFromClick, type ComposerFocusClick } from "./composer-focus"

const base: ComposerFocusClick = {
  button: 0, detail: 1, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  selectionCollapsed: true, interactive: false,
}

test("plain single left click on text focuses", () => {
  expect(shouldFocusComposerFromClick(base)).toBe(true)
})

test("rejects non-primary / modifiers / multi-click", () => {
  expect(shouldFocusComposerFromClick({ ...base, button: 2 })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, detail: 2 })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, ctrlKey: true })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, metaKey: true })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, altKey: true })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, shiftKey: true })).toBe(false)
})

test("rejects text selection and interactive targets", () => {
  expect(shouldFocusComposerFromClick({ ...base, selectionCollapsed: false })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, selectionCollapsed: null })).toBe(true)
  expect(shouldFocusComposerFromClick({ ...base, interactive: true })).toBe(false)
})
