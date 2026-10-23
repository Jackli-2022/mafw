import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("quote reply wiring", () => {
  test("ChatPane tracks selection, inserts a quote, and prioritizes Esc", () => {
    const pane = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(pane).toContain("formatQuote")
    expect(pane).toContain("appendQuote")
    expect(pane).toContain("QuoteToolbar")
    expect(pane).toContain("quoteAnchor")
    expect(pane).toContain("selectionchange")
    expect(pane).toContain('"mouseup"')
    expect(pane).toContain("dismissQuote")
    expect(pane).toContain("suppressQuote")
    expect(pane).toContain("sameQuoteSelection")
    expect(pane).toContain("onQuoteEsc")
    expect(pane).toContain("stopImmediatePropagation")
    expect(pane).toContain("readOnly")
    expect(pane).toContain("[data-message]")
    expect(pane).toContain("handleScroll(); suppressQuote()")
  })

  test("QuoteToolbar portals to body and preserves the selection on mousedown", () => {
    const toolbar = read("src/renderer/mafw/components/QuoteToolbar.tsx")
    expect(toolbar).toContain("Portal")
    expect(toolbar).toContain("onMouseDown")
    expect(toolbar).toContain("preventDefault")
  })

  test("toolbar styles exist", () => {
    expect(read("src/renderer/mafw/mafw.css")).toContain(".mafw-quote-toolbar")
  })
})
