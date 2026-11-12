import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldAutoOpenPicker } from "./landing"

test("opens the picker once when a world has no focus", () => {
  const base = {
    worldId: "w1",
    focusCount: 0,
    pickerOpen: false,
    rightDockOpen: true,
    lastAutoPickerWorld: null,
  }
  assert.equal(shouldAutoOpenPicker(base), true)
  assert.equal(shouldAutoOpenPicker({ ...base, lastAutoPickerWorld: "w1" }), false)
  assert.equal(shouldAutoOpenPicker({ ...base, focusCount: 1 }), false)
  assert.equal(shouldAutoOpenPicker({ ...base, rightDockOpen: false }), false)
})
