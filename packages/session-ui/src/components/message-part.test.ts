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
