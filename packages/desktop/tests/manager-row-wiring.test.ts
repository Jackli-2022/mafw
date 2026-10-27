import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("ManagerCard is a single pinned row with CN phase", () => {
  const src = read("src/renderer/mafw/components/ManagerCard.tsx")
  assert.match(src, /mafw-manager-row/)
  assert.match(src, /managerPhaseLabel\(/)
  assert.match(src, /mafw-manager-row-progress/)
  assert.doesNotMatch(src, /mafw-manager-card-goal|mafw-manager-card-meta/)
})

test("manager row CSS replaces the card block", () => {
  const css = read("src/renderer/mafw/mafw.css")
  const row = css.match(/\.mafw-manager-row \{([^}]*)\}/)?.[1] ?? ""
  assert.match(row, /height: 32px/)
  assert.match(css, /\.mafw-manager-row-badge/)
  assert.match(css, /\.mafw-manager-row-progress/)
  assert.doesNotMatch(css, /\.mafw-manager-card \{/)
  assert.doesNotMatch(css, /\.mafw-manager-card-goal/)
})
