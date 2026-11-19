import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"
import { readPartText } from "./message-part-text"

const componentSource = fs.readFileSync(new URL("./message-part.tsx", import.meta.url), "utf-8")

describe("read tool card", () => {
  test("renders its output in a collapsible body like list/glob/grep", () => {
    const start = componentSource.indexOf('name: "read"')
    const end = componentSource.indexOf('name: "list"')
    const block = componentSource.slice(start, end)
    expect(block).toContain('data-component="tool-output"')
    expect(block).toContain("Markdown text={props.output!}")
  })
})

describe("ToolPartDisplay presentation wiring", () => {
  test("passes normalized history output and uses the shared ToolCard", () => {
    expect(componentSource).toContain("partOutputText(part().state)")
    expect(componentSource).toContain("<ToolCard")
  })

  test("does not pass raw state.output only", () => {
    expect(componentSource).not.toContain("output={part().state.output}")
  })

  test("uses the override-aware decision and generic fallback", () => {
    expect(componentSource).toContain("shouldUsePresentation")
    expect(componentSource).toContain("genericPresentation")
    expect(componentSource).toContain("resolveToolEntry")
  })
})

describe("diff tools use the shared presentation path", () => {
  const block = (name: string, next: string) => {
    const start = componentSource.indexOf(`name: "${name}"`)
    return componentSource.slice(start, componentSource.indexOf(`name: "${next}"`, start))
  }

  test("edit/write/apply_patch register present + renderBody without a legacy shell", () => {
    const edit = block("edit", "write")
    expect(edit).toContain('present: (ctx) => presentDiffTool("edit", ctx)')
    expect(edit).toContain("renderBody: EditBody")
    expect(edit).not.toContain("BasicTool")

    const write = block("write", "apply_patch")
    expect(write).toContain('present: (ctx) => presentDiffTool("write", ctx)')
    expect(write).toContain("renderBody: WriteBody")

    const patch = block("apply_patch", "todowrite")
    expect(patch).toContain('present: (ctx) => presentDiffTool("apply_patch", ctx)')
    expect(patch).toContain("renderBody: ApplyPatchBody")
  })

  test("details mode still drives defaultOpen and error parts stay generic", () => {
    expect(componentSource).toContain("defaultOpen={props.defaultOpen}")
    for (const [name, next] of [["edit", "write"], ["write", "apply_patch"], ["apply_patch", "todowrite"]] as const) {
      expect(block(name, next)).not.toContain("handlesError")
    }
  })
})

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})
