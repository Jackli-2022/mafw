import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { isAnnotationHotkey } from "./annotation-hotkey"

describe("isAnnotationHotkey（M10：macOS Cmd+M 是系统最小化）", () => {
  test("Windows/Linux：Ctrl+M 与 Meta+M 都认", () => {
    assert.equal(isAnnotationHotkey({ ctrlKey: true, metaKey: false, code: "KeyM" }, false), true)
    assert.equal(isAnnotationHotkey({ ctrlKey: false, metaKey: true, code: "KeyM" }, false), true)
  })
  test("macOS：只认 Ctrl+M，不抢 Cmd+M", () => {
    assert.equal(isAnnotationHotkey({ ctrlKey: true, metaKey: false, code: "KeyM" }, true), true)
    assert.equal(isAnnotationHotkey({ ctrlKey: false, metaKey: true, code: "KeyM" }, true), false)
  })
  test("非 M / 无修饰键 → false", () => {
    assert.equal(isAnnotationHotkey({ ctrlKey: true, metaKey: false, code: "KeyK" }, false), false)
    assert.equal(isAnnotationHotkey({ ctrlKey: false, metaKey: false, code: "KeyM" }, false), false)
  })
})
