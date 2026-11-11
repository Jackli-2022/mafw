import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../src/renderer/mafw/mafw.css", import.meta.url), "utf8")

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return css.match(new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`))?.[1] ?? ""
}

test("project home lays files and recents side by side in one surface", () => {
  const content = rule(".mafw-project-home-content")
  assert.match(content, /display:\s*grid/)
  assert.match(content, /grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s*minmax\(0,\s*0\.8fr\)/)
  assert.match(content, /gap:\s*0/)
  assert.match(content, /border-radius:\s*var\(--r-/)
  assert.match(css, /\.mafw-project-home-content\.is-single\s*\{[^}]*grid-template-columns:\s*1fr/)
  assert.match(css, /\.mafw-project-files-card\s*\{\s*border-right:\s*1px solid var\(--border-subtle\)/)
  assert.match(rule(".mafw-project-recent-card"), /border:\s*0/)
  assert.doesNotMatch(rule(".mafw-project-files-card"), /border-radius:\s*var\(--r-/)
})

test("project home stacks content cards in a narrow container", () => {
  assert.match(css, /@container \(max-width:\s*760px\)[\s\S]*?mafw-project-home-content[\s\S]*?grid-template-columns:\s*1fr/)
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
