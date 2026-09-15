import { describe, expect, test } from "bun:test"
import { validateWidget, validateCard } from "../shared/ui-plugins"

describe("widget vocabulary v2 (markdown + progress)", () => {
  test("markdown widget keeps text and escapes nothing at validate time", () => {
    const w = validateWidget({ type: "markdown", text: "# Hi\n\n- a" })
    expect(w).toEqual({ type: "markdown", text: "# Hi\n\n- a" })
  })

  test("markdown with non-string text is stringified, not dropped", () => {
    const w = validateWidget({ type: "markdown", text: { deep: true } })
    expect(w?.type).toBe("markdown")
    expect((w as any).text).toContain("deep")
  })

  test("progress clamps out-of-range values", () => {
    expect(validateWidget({ type: "progress", value: 150 })).toEqual({ type: "progress", value: 100 })
    expect(validateWidget({ type: "progress", value: -5 })).toEqual({ type: "progress", value: 0 })
  })

  test("progress accepts numeric strings and drops bad ones to 0", () => {
    expect(validateWidget({ type: "progress", value: "42" })).toEqual({ type: "progress", value: 42 })
    expect(validateWidget({ type: "progress", value: "abc" })).toEqual({ type: "progress", value: 0 })
  })

  test("progress label passes through when string", () => {
    expect(validateWidget({ type: "progress", value: 30, label: "下载" })).toEqual({ type: "progress", value: 30, label: "下载" })
  })

  test("validateCard accepts the new widgets in body", () => {
    const card = validateCard({
      title: "T",
      body: [{ type: "markdown", text: "**b**" }, { type: "progress", value: 50 }],
    })
    expect(card?.body).toHaveLength(2)
    expect(card?.body[0].type).toBe("markdown")
    expect(card?.body[1].type).toBe("progress")
  })
})
