import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../src/renderer/mafw/mafw.css", import.meta.url), "utf8")

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return css.match(new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`))?.[1] ?? ""
}

test("project home uses two full-height columns: content and all goals", () => {
  const grid = rule(".mafw-project-home-grid")
  assert.match(grid, /flex:\s*1/)
  assert.match(grid, /display:\s*grid/)
  assert.match(grid, /grid-template-columns:\s*minmax\(0,\s*1\.35fr\)\s*minmax\(0,\s*1fr\)/)
  assert.match(grid, /gap:\s*16px/)
  assert.match(css, /\.mafw-project-home-grid\.is-single\s*\{[^}]*grid-template-columns:\s*1fr/)

  const content = rule(".mafw-project-home-content")
  assert.match(content, /display:\s*flex/)
  assert.match(content, /height:\s*100%/)
  assert.match(content, /border-radius:\s*var\(--r-/)

  assert.match(css, /\.mafw-project-files-card\s*\{\s*flex:\s*1 1 auto/)
  assert.match(css, /\.mafw-project-recent-card\s*\{\s*flex:\s*0 0 180px/)
  assert.match(css, /\.mafw-project-home-goals > \.mafw-work-overview\s*\{[^}]*flex:\s*1/)
  assert.match(css, /\.mafw-project-home-goals \.mafw-work-list\s*\{[^}]*overflow-y:\s*auto/)
})

test("project home stacks content above goals in a narrow container", () => {
  assert.match(css, /@container \(max-width:\s*980px\)[\s\S]*?mafw-project-home-grid[\s\S]*?grid-template-columns:\s*1fr/)
  assert.match(css, /@container \(max-width:\s*980px\)[\s\S]*?mafw-project-home-content\s*\{\s*height:\s*420px/)
  assert.match(css, /@container \(max-width:\s*980px\)[\s\S]*?mafw-project-home-goals\s*\{\s*min-height:\s*380px/)
})

test("team strip is a quiet project attribute line, not another card", () => {
  const strip = rule(".mafw-project-team-strip")
  assert.match(strip, /display:\s*flex/)
  assert.match(strip, /flex-wrap:\s*wrap/)
  assert.match(strip, /border-bottom:\s*1px solid var\(--border-subtle\)/)
  assert.match(strip, /background:\s*transparent/)
  assert.match(css, /\.mafw-project-team-actions\s*\{[^}]*flex:\s*none/)
  assert.match(css, /\.mafw-project-team-empty\s*\{[^}]*var\(--text-/)
})

test("new project home rules use theme tokens, not raw colors", () => {
  for (const selector of [
    ".mafw-project-home-grid",
    ".mafw-project-home-content",
    ".mafw-project-files-card",
    ".mafw-project-recent-card",
    ".mafw-project-recent-row",
    ".mafw-project-team-strip",
    ".mafw-project-team-chip",
  ]) {
    const body = rule(selector)
    assert.ok(body.length > 0, `${selector} missing`)
    assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/)
  }
})
