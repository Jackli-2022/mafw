import { describe, expect, test } from "bun:test"
import { resolveEditorEngine } from "./editor-engine"

describe("resolveEditorEngine（编辑器内核选择）", () => {
  test("缺省 = Monaco", () => {
    expect(resolveEditorEngine(() => null)).toBe("monaco")
  })

  test("显式 codemirror = 回退", () => {
    expect(resolveEditorEngine(() => "codemirror")).toBe("codemirror")
  })

  test("其它值仍按默认 Monaco（未知值不降级）", () => {
    expect(resolveEditorEngine(() => "monaco")).toBe("monaco")
    expect(resolveEditorEngine(() => "whatever")).toBe("monaco")
  })

  test("存储抛错 = Monaco（fail-open）", () => {
    expect(resolveEditorEngine(() => { throw new Error("denied") })).toBe("monaco")
  })
})
