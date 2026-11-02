// Task 11 fix round: plugin message window CSS contracts.
//
// The modeless stack must stay inside the main window even when two 60vh
// windows would overflow, and every card must keep its header/close button
// reachable. Modals are fixed backdrops; lower stacked modals are hidden.
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

describe("plugin message window css", () => {
  test("modeless stack caps to the viewport and scrolls", () => {
    const stack = block(".mafw-plugin-windows {")
    assert.match(stack, /max-height:\s*calc\(100vh - 32px\)/)
    assert.match(stack, /overflow-y:\s*auto/)
    assert.match(stack, /pointer-events:\s*none/)
    assert.match(stack, /scrollbar-width:\s*none/)
  })

  test("two full-height cards always fit; 3+ scroll inside the capped stack", () => {
    const inner = block(".mafw-plugin-windows .mafw-plugin-window {")
    assert.match(inner, /max-height:\s*min\(60vh, calc\(\(100vh - 40px\) \/ 2\)\)/)
  })

  test("cards keep their header and close button while the body scrolls", () => {
    const card = block("\n.mafw-plugin-window {")
    assert.match(card, /flex:\s*0 0 auto/)
    assert.match(block(".mafw-plugin-window-head {"), /flex:\s*0 0 auto/)
    assert.match(block(".mafw-plugin-window-body {"), /overflow-y:\s*auto/)
  })

  test("modal uses a fixed backdrop and lower stacked modals are hidden", () => {
    const backdrop = block(".mafw-plugin-window-backdrop {")
    assert.match(backdrop, /position:\s*fixed/)
    assert.match(backdrop, /inset:\s*0/)
    assert.match(css, /\.mafw-plugin-window-backdrop\.is-under\s*\{\s*visibility:\s*hidden/)
    assert.match(css, /\.mafw-plugin-window\.is-under\s*\{\s*visibility:\s*hidden/)
  })

  test("window blocks use design tokens instead of raw hex colors", () => {
    for (const selector of ["\n.mafw-plugin-window {", ".mafw-plugin-window-backdrop {"]) {
      assert.doesNotMatch(block(selector), /#[0-9a-f]{3,8}/i, selector)
    }
  })
})
