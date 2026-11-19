import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const tsx = fs.readFileSync(new URL("./tool-card.tsx", import.meta.url), "utf-8")
const css = fs.readFileSync(new URL("./tool-card.css", import.meta.url), "utf-8")

describe("ToolCard shell", () => {
  test("renders both states and both custom slots", () => {
    expect(tsx).toContain("data-state")
    expect(tsx).toContain("mafw-tool-card")
    expect(tsx).toContain("Collapsible.Arrow")
    expect(tsx).toContain("renderCollapsed")
    expect(tsx).toContain("renderBody")
  })

  test("locks the collapsed row and fades only before the chevron", () => {
    expect(css).toContain("--mafw-tool-content-left: 6px")
    expect(css).toContain("max-height: 28px")
    expect(css).toContain("mask-image")
    expect(css).toContain("calc(100% - 8px)")
  })

  test("renders link actions in the expanded body", () => {
    expect(tsx).toContain("mafw-tool-card-link")
    expect(tsx).toContain("expanded.actions")
  })
})
