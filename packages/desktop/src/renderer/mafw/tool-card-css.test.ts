import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "mafw.css"), "utf8")

describe("tool card trigger (v8)", () => {
  test("trigger row is 26px with a 13px title and 11px args", () => {
    expect(css).toMatch(/\[data-slot="collapsible-trigger"\]\s*\{[^}]*height:\s*26px/)
    expect(css).toMatch(/\[data-slot="basic-tool-tool-title"\]\s*\{[^}]*font-size:\s*13px/)
    expect(css).toMatch(/\[data-slot="basic-tool-tool-arg"\]\s*\{[^}]*font-size:\s*11px/)
  })
  test("status badge class exists with tone variants", () => {
    expect(css).toMatch(/\.mafw-tool-badge\s*\{/)
    expect(css).toMatch(/\.mafw-tool-badge\[data-tone="ok"\]/)
    expect(css).toMatch(/\.mafw-tool-badge\[data-tone="err"\]/)
  })
  test("trigger title keeps base color (shimmer not clobbered)", () => {
    expect(css).toMatch(/\[data-slot="basic-tool-tool-title"\]\s*\{[^}]*color:\s*var\(--text-1\)/)
  })
})

describe("tool card body surface (v8)", () => {
  test("content box has hairline + radius + inset background", () => {
    expect(css).toMatch(/\.mafw-tool-box\s*\{[^}]*border:\s*0\.5px solid var\(--border-subtle\)/)
    expect(css).toMatch(/\.mafw-tool-box\s*\{[^}]*border-radius:\s*var\(--r-md\)/)
    expect(css).toMatch(/\.mafw-tool-box\s*\{[^}]*background:\s*var\(--bg-inset\)/)
  })
  test("legacy left-rule indentation is gone", () => {
    expect(css).not.toMatch(/\[data-slot="collapsible-content"\]\s*>\s*\*\s*\{[^}]*border-left/)
  })
  test("code output uses the data font", () => {
    expect(css).toMatch(/\.mafw-tool-output\s*\{[^}]*font-family:\s*var\(--font-data\)/)
  })
})
