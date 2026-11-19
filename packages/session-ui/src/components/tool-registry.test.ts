import { describe, expect, test } from "bun:test"
import { ToolRegistry } from "./tool-registry"

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
