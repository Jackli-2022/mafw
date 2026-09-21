import { describe, expect, test } from "bun:test"
import { navItems, isNavKey, type NavKey } from "./config-nav"

describe("config-nav", () => {
  test("every nav item uses an SVG icon name, never emoji", () => {
    for (const item of navItems()) {
      expect(item.icon).toMatch(/^[a-z][a-z-]*$/)
    }
  })

  test("covers the nine nav keys exactly once, in order", () => {
    const keys = navItems().map((i) => i.key)
    expect(keys).toEqual(["gateway", "desktop", "plugins", "models", "memory", "usage", "approvals", "opencode", "mafw"])
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("every item has label and desc", () => {
    for (const item of navItems()) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.desc.length).toBeGreaterThan(0)
    }
  })

  test("isNavKey accepts only known keys", () => {
    expect(isNavKey("gateway")).toBe(true)
    expect(isNavKey("mafw")).toBe(true)
    expect(isNavKey("nope")).toBe(false)
    expect(isNavKey(undefined)).toBe(false)
    const keys: NavKey[] = navItems().map((i) => i.key)
    for (const k of keys) expect(isNavKey(k)).toBe(true)
  })
})
