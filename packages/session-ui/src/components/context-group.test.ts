import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"
import { presentRowTool } from "./tool-presenters"
import { resolvePresentation, type ToolPresentationContext } from "./tool-presentation"

const source = fs.readFileSync(new URL("./message-part.tsx", import.meta.url), "utf-8")

describe("context tool group", () => {
  test("uses the shared presentation instead of the old context trigger builder", () => {
    expect(source).not.toContain("contextToolTrigger")
    expect(source).not.toContain("contextToolDetail")
    expect(source).toContain("resolvePresentation")
    expect(source).toContain('mode: "context"')
    expect(source).toContain("<ToolCard")
    expect(source).toContain("group />")
  })

  test("read with file_path shows a filename, not undefined", () => {
    const ctx: ToolPresentationContext = {
      props: { tool: "read", input: { file_path: "C:/repo/src/a.ts" }, metadata: {}, status: "completed" },
      directory: "C:/repo",
      mode: "context",
      t: (key) => key,
    }
    const out = resolvePresentation(presentRowTool("read", ctx), ctx)
    expect(out.collapsed.object).toBe("a.ts")
  })
})
