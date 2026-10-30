import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../src/renderer/mafw/mafw.css", import.meta.url), "utf8")

const block = (selector: string) => {
  const start = css.indexOf(selector)
  if (start < 0) return ""
  const open = css.indexOf("{", start)
  return css.slice(open + 1, css.indexOf("}", open))
}

describe("pod panel css", () => {
  test("board uses an auto-fit grid and tokens", () => {
    assert.match(block(".mafw-pod-board {"), /grid-template-columns: repeat\(auto-fit, minmax\(112px, 1fr\)\)/)
    assert.match(block(".mafw-pod-board {"), /gap: 8px/)
  })
  test("member rows and badge use existing tokens", () => {
    assert.match(block(".mafw-pod-member {"), /var\(--border-subtle\)/)
    assert.match(block(".mafw-session-pod-badge {"), /var\(--accent-soft\)/)
  })
  test("no raw colors in pod blocks", () => {
    for (const selector of [".mafw-pod-dock {", ".mafw-pod-task {", ".mafw-pod-inbox {", ".mafw-pod-memory {"]) {
      assert.doesNotMatch(block(selector), /#[0-9a-f]{3,8}/i, selector)
    }
  })
  test("pod rows join the focus-visible ring group", () => {
    assert.match(css, /\.mafw-pod-member:focus-visible/)
    assert.match(css, /\.mafw-pod-goal-row:focus-visible/)
    assert.match(css, /\.mafw-pod-task\.is-link:focus-visible/)
  })
  test("narrow dock collapses the board to two columns", () => {
    assert.match(block(".mafw-pod-dock {"), /container-type: inline-size/)
    assert.match(css, /@container \(max-width: 560px\)/)
    assert.match(css, /\.mafw-pod-board \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  })
})
