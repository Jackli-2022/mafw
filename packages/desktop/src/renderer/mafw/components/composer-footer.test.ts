import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("the context meta row renders below the composer", () => {
  const pane = read("ChatPane.tsx")
  const composer = pane.indexOf('class="mafw-composer"')
  const footer = pane.indexOf('class="mafw-composer-footer"')
  assert.ok(composer > 0, "composer box not found")
  assert.ok(footer > composer, "footer must follow the composer in DOM order")
  // The chip lives inside the footer, not above the input box.
  const chip = pane.indexOf("<ContextChip", footer)
  assert.ok(chip > footer, "ContextChip must be rendered inside the footer")
  assert.equal(pane.indexOf('class="mafw-composer-context"'), -1)
})

test("the footer is a three-zone strip with the pulse centered", () => {
  const css = read("../mafw.css")
  const rule = css.match(/\.mafw-composer-footer \{([^}]*)\}/)?.[1] ?? ""
  assert.match(rule, /display:\s*grid/)
  assert.match(rule, /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/)
  assert.match(css, /\.mafw-composer-footer-metrics \{[^}]*justify-content:\s*center/)
  assert.equal(css.includes(".mafw-composer-context"), false)
})

test("the footer shows cache hit, total tokens, speed and turns", () => {
  const pane = read("ChatPane.tsx")
  const footer = pane.indexOf('class="mafw-composer-footer"')
  const metrics = pane.indexOf('class="mafw-composer-footer-metrics"', footer)
  const chip = pane.indexOf("<ContextChip", footer)
  assert.ok(chip > footer && chip < metrics, "time chip must sit left of the centered pulse")
  for (const token of ["缓存命中", "tokens", "tok/s", "回合"]) {
    assert.ok(pane.includes(token), `footer missing ${token}`)
  }
})
