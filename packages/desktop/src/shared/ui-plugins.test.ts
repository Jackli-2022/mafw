import { describe, expect, test } from "bun:test"
import { validateCard, validateWidget, shouldUseUserCard } from "./ui-plugins"

describe("validateWidget", () => {
  test("passes through the 8 vocabulary types", () => {
    expect(validateWidget({ type: "text", text: "hi" })).toEqual({ type: "text", text: "hi" })
    expect(validateWidget({ type: "code", text: "x" })).toEqual({ type: "code", text: "x" })
    expect(validateWidget({ type: "kv", rows: [["a", "1"]] })).toEqual({ type: "kv", rows: [["a", "1"]] })
    expect(validateWidget({ type: "tags", items: ["x"] })).toEqual({ type: "tags", items: ["x"] })
    expect(validateWidget({ type: "list", items: ["a"] })).toEqual({ type: "list", items: ["a"] })
    expect(validateWidget({ type: "row", children: [{ type: "text", text: "x" }] })).toEqual({ type: "row", children: [{ type: "text", text: "x" }] })
    expect(validateWidget({ type: "image", dataUrl: "data:image/png;base64,x" })).toEqual({ type: "image", dataUrl: "data:image/png;base64,x" })
    expect(validateWidget({ type: "link", text: "t", href: "https://x" })).toEqual({ type: "link", text: "t", href: "https://x" })
  })

  test("degrades unknown types to text", () => {
    expect(validateWidget({ type: "video", src: "x" })).toEqual({ type: "text", text: '{"type":"video","src":"x"}' })
  })

  test("recurses into list/row children and drops invalid entries", () => {
    const w = validateWidget({ type: "list", items: ["a", { type: "text", text: "b" }, null] })
    expect(w).toEqual({ type: "list", items: ["a", { type: "text", text: "b" }] })
  })

  test("null/undefined input returns null", () => {
    expect(validateWidget(null)).toBeNull()
    expect(validateWidget(undefined)).toBeNull()
  })
})

describe("validateCard", () => {
  test("accepts card with body and validates its widgets", () => {
    const c = validateCard({ title: "T", body: [{ type: "text", text: "x" }, { type: "bogus" }] })
    expect(c?.title).toBe("T")
    expect(c?.body).toEqual([{ type: "text", text: "x" }, { type: "text", text: '{"type":"bogus"}' }])
  })

  test("rejects card with neither body nor title", () => {
    expect(validateCard({})).toBeNull()
    expect(validateCard("str")).toBeNull()
  })

  test("accepts title-only card with empty body", () => {
    expect(validateCard({ title: "only" })).toEqual({ title: "only", body: [] })
  })
})

describe("shouldUseUserCard", () => {
  test("no entry → false", () => {
    expect(shouldUseUserCard(undefined, false)).toBe(false)
  })
  test("unregistered tool → true", () => {
    expect(shouldUseUserCard({ tool: "t", override: false }, false)).toBe(true)
  })
  test("registered tool without override → false", () => {
    expect(shouldUseUserCard({ tool: "t", override: false }, true)).toBe(false)
  })
  test("registered tool with override → true", () => {
    expect(shouldUseUserCard({ tool: "t", override: true }, true)).toBe(true)
  })
})
