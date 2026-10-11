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
})
