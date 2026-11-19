import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const css = fs.readFileSync(new URL("./basic-tool.css", import.meta.url), "utf-8")

describe("basic-tool CSS cleanup", () => {
  test("no longer ships the deleted task-card markup", () => {
    expect(css).not.toContain("task-tool")
    expect(css).not.toContain("agent-title")
  })
})
