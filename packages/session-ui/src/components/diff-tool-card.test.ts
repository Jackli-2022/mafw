import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const src = fs.readFileSync(new URL("./diff-tool-card.tsx", import.meta.url), "utf-8")

describe("diff card bodies", () => {
  test("exports body-only components and keeps the diff renderer contract", () => {
    for (const name of ["EditBody", "WriteBody", "ApplyPatchBody"]) expect(src).toContain(`export function ${name}`)
    expect(src).toContain('mode="diff"')
    expect(src).toContain("virtualize={props.virtualizeDiff}")
    expect(src).toContain("onRendered={props.onContentRendered}")
    expect(src).not.toContain("BasicTool")
  })

  test("keeps deferred per-file mounting, diagnostics, and the file accordion", () => {
    expect(src).toContain("props.deferContent === false || visible()")
    expect(src).toContain("DiagnosticsDisplay")
    expect(src).toContain("ToolFileAccordion")
  })
})
