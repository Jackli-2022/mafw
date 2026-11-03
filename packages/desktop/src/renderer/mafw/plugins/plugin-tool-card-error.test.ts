// Final review B finding 3: a unified tool card owns error rendering
// (`handlesError: true`) but the fallback path used to drop the error, so a
// failed tool showed "Called tool" with no reason. The fallback must render the
// settled part error above the original/generic card.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const component = readFileSync(new URL("./PluginToolCard.tsx", import.meta.url), "utf8")
const css = readFileSync(new URL("../mafw.css", import.meta.url), "utf8")

function cssRule(selector: string): string {
  const start = css.indexOf(selector)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = css.indexOf("}", start)
  expect(end).toBeGreaterThan(start)
  return css.slice(start, end + 1)
}

describe("unified tool card error fallback", () => {
  test("the fallback keeps the original card and renders the part error", () => {
    expect(component).toContain("props.error")
    expect(component).toContain("mafw-plugin-tool-fallback")
    expect(component).toContain("mafw-plugin-tool-error")
    // The original card is still rendered alongside the error line.
    expect(component).toContain("original ? original(props) : <GenericTool {...props} />")
  })

  test("the error style uses danger tokens without raw hex", () => {
    const rule = cssRule(".mafw-plugin-tool-error")
    expect(rule).toContain("font-size: 12px")
    expect(rule).toContain("var(--danger-text)")
    expect(rule).toContain("overflow-wrap: anywhere")
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})
