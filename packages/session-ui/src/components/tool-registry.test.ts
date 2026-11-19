import { describe, expect, test } from "bun:test"
import { ToolRegistry, shouldUsePresentation } from "./tool-registry"

describe("ToolRegistry presentation surface", () => {
  test("has() sees a presenter-only entry", () => {
    ToolRegistry.register({ name: "present_only", present: () => ({}) })
    expect(ToolRegistry.has("present_only")).toBe(true)
    expect(ToolRegistry.names()).toContain("present_only")
  })
  test("override wins and restore brings back present", () => {
    const original = () => null
    ToolRegistry.register({ name: "overridable", present: () => ({}) })
    const restore = ToolRegistry.override("overridable", original)
    expect(ToolRegistry.entry("overridable")?.override).toBe(true)
    expect(ToolRegistry.entry("overridable")?.render).toBe(original)
    restore()
    expect(ToolRegistry.entry("overridable")?.present).toBeDefined()
    expect(ToolRegistry.entry("overridable")?.override).toBeUndefined()
  })
})

describe("shouldUsePresentation", () => {
  test("present and custom slots are used", () => {
    expect(shouldUsePresentation({ name: "a", present: () => ({}) })).toBe(true)
    expect(shouldUsePresentation({ name: "b", renderCollapsed: () => null as any })).toBe(true)
    expect(shouldUsePresentation({ name: "c", renderBody: () => null as any })).toBe(true)
  })
  test("legacy render alone is not a presentation", () => {
    expect(shouldUsePresentation({ name: "d", render: () => null as any })).toBe(false)
    expect(shouldUsePresentation(undefined)).toBe(false)
  })
  test("plugin override suppresses present", () => {
    expect(shouldUsePresentation({ name: "e", present: () => ({}), render: () => null as any, override: true })).toBe(false)
  })
})
